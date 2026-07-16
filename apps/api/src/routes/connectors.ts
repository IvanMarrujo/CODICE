// ============================================================
// CÓDICE · Connectors routes
// Conectores de datos legacy -> employees / payroll_records
// (schema del tenant).
//
// Modelo "live-wire": el archivo conectado se persiste en
// `connected_sources` (base64) y queda como fuente de verdad —
// "Recargar ahora" / auto-sync vuelven a correr el ETL sobre esa
// misma copia sin pedir un nuevo upload; "Reemplazar archivo"
// sustituye la copia y dispara un reload automático.
// ============================================================

import { Router, Request, Response, NextFunction, RequestHandler } from 'express'
import multer                                       from 'multer'
import * as path                                     from 'path'
import * as crypto                                   from 'crypto'
import archiver                                      from 'archiver'
import { z }                                         from 'zod'
import { Prisma }                                    from '@prisma/client'
import { requireHR }                                 from '../middleware/auth'
import { AppError }                                  from '../lib/errors'
import { redis }                                     from '../lib/redis'
import { parseExcelBuffer, previewExcelBuffer, ParsedEmployeeRow } from '../connectors/excel/excelParser'
import { CANONICAL_FIELD_LABELS }                     from '../connectors/excel/fieldMapper'
import { parseCfdiBuffer }                           from '../connectors/cfdi/cfdiParser'
import { parseEmpleaDbf, parseNominaDbf }             from '../connectors/dbf/dbfParser'
import { EmployeeUpsertRow, PayrollUpsertRow }        from '../connectors/common'
import { createSyncLog, markSyncRunning, finishSync, failSync, SyncRowError } from '../services/syncService'
import { prismaPublic }                              from '../lib/prisma'
import { registerAutoSync, unregisterAutoSync }       from '../jobs/autoSyncQueue'
import { emitSyncComplete }                          from '../lib/syncEmitter'

const router = Router()

router.get('/', (req, res) => res.json({ route: 'connectors', status: 'ok' }))

// ── GET /api/connectors/sync-log/latest ──────────────────────
// Último SyncLog del tenant, para la card "Archivo conectado".

router.get('/sync-log/latest', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb
    const latest = await prismaPublic.syncLog.findFirst({
      where:   { tenantId },
      orderBy: { startedAt: 'desc' },
    })
    if (!latest) return res.json(null)

    const [{ count: employeeCount }] = await tenantDb.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM employees WHERE tenant_id = ${tenantId}
    `
    const [{ count: payrollRecordCount }] = await tenantDb.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM payroll_records WHERE tenant_id = ${tenantId}
    `
    res.json({ ...latest, employeeCount, payrollRecordCount })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/connectors/sync-log/history ─────────────────────
// Últimas 10 sincronizaciones del tenant, para la tabla de historial.

router.get('/sync-log/history', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const history = await prismaPublic.syncLog.findMany({
      where:   { tenantId },
      orderBy: { startedAt: 'desc' },
      take:    10,
    })
    res.json({ data: history })
  } catch (err) {
    next(err)
  }
})

// ── Upload middlewares ───────────────────────────────────────

function translateMulterError(err: multer.MulterError): string {
  if (err.code === 'LIMIT_FILE_SIZE') return 'Uno de los archivos supera el tamaño máximo permitido'
  if (err.code === 'LIMIT_FILE_COUNT') return 'Se pueden subir máximo 200 archivos a la vez'
  return err.message
}

function makeUploadHandler(uploadMw: RequestHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    uploadMw(req, res, (err: any) => {
      if (!err) return next()
      if (err instanceof multer.MulterError) return next(new AppError(400, translateMulterError(err)))
      next(err)
    })
  }
}

// .xlsx / .csv, max 10MB, max 200 archivos
const ALLOWED_EXCEL_EXT = new Set(['.xlsx', '.csv'])
const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024, files: 200 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (!ALLOWED_EXCEL_EXT.has(ext)) {
      return cb(new AppError(400, `Tipo de archivo no soportado: "${file.originalname}". Solo se aceptan .xlsx y .csv`))
    }
    cb(null, true)
  },
}).array('files', 200)
const handleExcelUpload = makeUploadHandler(excelUpload)

// .xml (CFDI nómina), max 2MB c/u, max 200 archivos
const ALLOWED_CFDI_EXT = new Set(['.xml'])
const cfdiUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 2 * 1024 * 1024, files: 200 },
  fileFilter: (_req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() !== '.xml') {
      return cb(new AppError(400, `Tipo de archivo no soportado: "${file.originalname}". Solo se aceptan .xml`))
    }
    cb(null, true)
  },
}).array('files', 200)
const handleCfdiUpload = makeUploadHandler(cfdiUpload)

// .dbf (EMPLEA.DBF / NOMINA.DBF), max 20MB c/u, max 2 archivos
const ALLOWED_DBF_EXT = new Set(['.dbf'])
const dbfUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 20 * 1024 * 1024, files: 2 },
  fileFilter: (_req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() !== '.dbf') {
      return cb(new AppError(400, `Tipo de archivo no soportado: "${file.originalname}". Solo se aceptan .dbf`))
    }
    cb(null, true)
  },
}).array('files', 2)
const handleDbfUpload = makeUploadHandler(dbfUpload)

// Upload genérico para "Reemplazar archivo" — la extensión esperada depende
// del tipo de la conexión ya existente (EXCEL|CFDI|DBF), así que la
// validación de extensión se hace en el handler, no en el fileFilter.
const replaceUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 20 * 1024 * 1024, files: 200 },
}).array('files', 200)
const handleReplaceUpload = makeUploadHandler(replaceUpload)

const EXT_BY_SOURCE_TYPE: Record<string, Set<string>> = {
  EXCEL: ALLOWED_EXCEL_EXT,
  CFDI:  ALLOWED_CFDI_EXT,
  DBF:   ALLOWED_DBF_EXT,
}

// ── POST /api/connectors/preview/excel ───────────────────────
// Dry-run: parsea el archivo (headers + primeras filas) SIN escribir en DB.
// Usado por el wizard de conectores (Modo A, steps 3-4: field mapper + preview).

const previewExcelUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (!ALLOWED_EXCEL_EXT.has(ext)) {
      return cb(new AppError(400, `Tipo de archivo no soportado: "${file.originalname}". Solo se aceptan .xlsx y .csv`))
    }
    cb(null, true)
  },
}).single('file')
const handlePreviewExcelUpload = makeUploadHandler(previewExcelUpload)

router.post('/preview/excel', requireHR, handlePreviewExcelUpload, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const file = req.file as Express.Multer.File | undefined
    if (!file) throw new AppError(400, 'No se subió ningún archivo')

    // El usuario puede mandar overrides explícitos (ajustó el mapeo a mano y
    // volvió a este paso); si no manda nada, se intenta el mapeo guardado de
    // la última sincronización de este tenant para este tipo de fuente.
    let overrideMap: Record<string, string> | undefined
    let usingSavedMapping = false
    if (typeof req.body.fieldMap === 'string' && req.body.fieldMap) {
      try { overrideMap = JSON.parse(req.body.fieldMap) } catch { /* ignorar mapeo malformado */ }
    }
    if (!overrideMap) {
      const saved = await getSavedFieldMap(req.tenant.id, FIELD_MAP_SOURCE_TYPE)
      if (saved) { overrideMap = saved; usingSavedMapping = true }
    }

    const result = previewExcelBuffer(file.buffer, file.originalname, 5, overrideMap)
    const headers = result.headers.map((h) => ({
      ...h,
      fieldLabel: h.field ? CANONICAL_FIELD_LABELS[h.field] : null,
    }))

    // El banner de "mapeo guardado" solo tiene sentido si de verdad aplicó a
    // algún header de ESTE archivo — un mapeo guardado de otro layout no cuenta.
    usingSavedMapping = usingSavedMapping && headers.some((h) => h.field && overrideMap?.[h.label])

    res.json({ fileName: file.originalname, headers, preview: result.preview, totalRows: result.totalRows, errors: result.errors, usingSavedMapping })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/connectors/preview/cfdi ────────────────────────
// Dry-run: parsea hasta 5 CFDI SIN escribir en DB (preview del wizard).
// El formato CFDI es estructurado (XML timbrado por el SAT) — no hay
// "mapeo de columnas" que decidir, por eso el wizard salta el Step 3
// para este formato y va directo al preview de filas.

const previewCfdiUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 2 * 1024 * 1024, files: 200 },
  fileFilter: (_req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() !== '.xml') {
      return cb(new AppError(400, `Tipo de archivo no soportado: "${file.originalname}". Solo se aceptan .xml`))
    }
    cb(null, true)
  },
}).array('files', 200)
const handlePreviewCfdiUpload = makeUploadHandler(previewCfdiUpload)

router.post('/preview/cfdi', requireHR, handlePreviewCfdiUpload, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const files = (req.files as Express.Multer.File[]) || []
    if (files.length === 0) throw new AppError(400, 'No se subió ningún archivo')

    const preview: any[] = []
    const errors: SyncRowError[] = []

    for (const file of files.slice(0, 5)) {
      const result = await parseCfdiBuffer(file.buffer, file.originalname)
      if (result.error || !result.employee || !result.payroll) {
        errors.push({ row: 0, file: file.originalname, message: result.error || 'CFDI sin datos utilizables' })
        continue
      }
      preview.push({ file: file.originalname, employee: result.employee, payroll: result.payroll })
    }

    res.json({ preview, totalRows: files.length, errors })
  } catch (err) {
    next(err)
  }
})

// ── Columnas de `employees` que estos conectores pueden escribir ─

const WRITABLE_EMPLOYEE_COLUMNS: (keyof EmployeeUpsertRow)[] = [
  'first_name', 'last_name', 'rfc', 'curp', 'nss', 'daily_salary', 'monthly_salary',
  'department', 'position', 'plant', 'shift', 'hire_date',
  'contract_type', 'status', 'employee_code', 'bank_name', 'bank_clabe', 'notes',
]

// ── Mapeo de columnas guardado por tenant + tipo de fuente ──────
// El tipo de fuente real que produce este flujo hoy es 'EXCEL_GENERIC'
// (ver runExcelSync) — el ejemplo del feature usaba "NOMIPAQ_EXCEL" mismo
// que no existe como constante distinta en el código actual; se usa el
// valor real para que el mapeo guardado efectivamente se reutilice.
const FIELD_MAP_SOURCE_TYPE = 'EXCEL_GENERIC'

function fieldMapKey(tenantId: string, sourceType: string) {
  return `t:${tenantId}:fieldmap:${sourceType}`
}

async function getSavedFieldMap(tenantId: string, sourceType: string): Promise<Record<string, string> | null> {
  const raw = await redis.get(fieldMapKey(tenantId, sourceType))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return (parsed && typeof parsed === 'object') ? parsed : null
  } catch {
    return null
  }
}

async function saveFieldMap(tenantId: string, sourceType: string, map: Record<string, string>): Promise<void> {
  if (Object.keys(map).length === 0) return
  await redis.set(fieldMapKey(tenantId, sourceType), JSON.stringify(map))
}

/** Construye el mapeo header-texto -> CanonicalField efectivamente usado en
 * un preview/import, combinando lo auto-detectado con overrides — es lo que
 * se persiste como "mapeo guardado" para la próxima subida del mismo tipo. */
function effectiveFieldMap(headers: { label: string; field: string | null }[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const h of headers) if (h.field) map[h.label] = h.field
  return map
}

const WRITABLE_PAYROLL_COLUMNS: (keyof PayrollUpsertRow)[] = [
  'folio', 'uuid_sat', 'payroll_type', 'period_start', 'period_end', 'payment_date',
  'days_paid', 'gross_taxable', 'gross_exempt', 'total_income', 'isr',
  'imss_employee', 'infonavit', 'other_deductions', 'total_deductions', 'net_pay',
  'period_label',
]

// ── Tipos compartidos para los runners de sync ───────────────
// Un "runner" hace parse + upsert + progreso para un tipo de conector.
// Los usan tanto /upload/* (primera conexión) como /:sourceId/reload y el
// job de auto-sync (re-correr el ETL sobre el archivo ya conectado).

interface ChangedEmployee {
  employeeId:      string
  newNetPay:       number
  previousNetPay:  number | null
  period:          string | null
  payrollRecordId: string
}

export interface SyncResult {
  processed:         number
  inserted:          number
  updated:           number
  errors:            SyncRowError[]
  employeesUpserted: number
  payrollUpserted:   number
  changedEmployees:  ChangedEmployee[]
  syncLogId:         string
}

interface SourceFile { buffer: Buffer; originalname: string }

// ── runExcelSync ──────────────────────────────────────────────

async function runExcelSync(tenantId: string, tenantDb: any, io: any, files: SourceFile[], overrideMap?: Record<string, string>): Promise<SyncResult> {
  const allRows: ParsedEmployeeRow[] = []
  const rowErrors: SyncRowError[] = []

  for (const file of files) {
    const { rows, errors } = parseExcelBuffer(file.buffer, file.originalname, overrideMap)
    allRows.push(...rows)
    for (const e of errors) rowErrors.push({ ...e, file: file.originalname })
  }

  // Cada fila cuenta como 1 unidad de progreso si solo trae datos de
  // empleado, o 2 si también trae nómina (upsert de employees + payroll_records).
  const total = allRows.reduce((sum, row) => sum + (row.payroll ? 2 : 1), 0)
  const syncLog = await createSyncLog(tenantId, 'EXCEL_GENERIC', total)
  await markSyncRunning(syncLog.id)

  let processed = 0
  let inserted  = 0
  let updated   = 0
  let employeesUpserted = 0
  let payrollUpserted   = 0
  const changedEmployees: ChangedEmployee[] = []

  const PROGRESS_EVERY = 10
  const emitProgress = () => {
    io?.to(`tenant:${tenantId}`).emit('sync:progress', { processed, total, errors: rowErrors })
  }

  try {
    for (const row of allRows) {
      let employeeId: string | undefined
      try {
        const { id, outcome } = await upsertEmployee(tenantDb, tenantId, row, 'EXCEL_GENERIC')
        employeeId = id
        if (outcome === 'inserted') inserted++
        else updated++
        employeesUpserted++
      } catch (err: any) {
        rowErrors.push({ row: row.row, message: err.message })
      } finally {
        processed++
        if (processed % PROGRESS_EVERY === 0 || processed === total) emitProgress()
      }

      if (employeeId && row.payroll) {
        try {
          const payrollResult = await upsertPayrollRecord(tenantDb, tenantId, employeeId, row.payroll, 'EXCEL_GENERIC')
          payrollUpserted++
          if (payrollResult.netPayChanged && payrollResult.newNetPay != null) {
            changedEmployees.push({ employeeId, newNetPay: payrollResult.newNetPay, previousNetPay: payrollResult.previousNetPay, period: payrollResult.periodLabel, payrollRecordId: payrollResult.payrollRecordId })
          }
        } catch (err: any) {
          rowErrors.push({ row: row.row, message: err.message })
        } finally {
          processed++
          if (processed % PROGRESS_EVERY === 0 || processed === total) emitProgress()
        }
      }
    }

    await finishSync(syncLog.id, { processed, errors: rowErrors, employeesProcessed: employeesUpserted, payrollProcessed: payrollUpserted })
    return { processed, inserted, updated, errors: rowErrors, employeesUpserted, payrollUpserted, changedEmployees, syncLogId: syncLog.id }
  } catch (err: any) {
    await failSync(syncLog.id, err.message)
    throw err
  }
}

// ── runCfdiSync ───────────────────────────────────────────────
// CFDI Nómina 1.2 (CONTPAQ) -> upsert employees + payroll_records.

async function runCfdiSync(tenantId: string, tenantDb: any, io: any, files: SourceFile[]): Promise<SyncResult> {
  const parsed: { employee: EmployeeUpsertRow; payroll: PayrollUpsertRow; file: string }[] = []
  const rowErrors: SyncRowError[] = []

  for (const file of files) {
    try {
      const result = await parseCfdiBuffer(file.buffer, file.originalname)
      if (result.error || !result.employee || !result.payroll) {
        rowErrors.push({ row: 0, file: file.originalname, message: result.error || 'CFDI sin datos utilizables' })
        continue
      }
      parsed.push({ employee: result.employee, payroll: result.payroll, file: file.originalname })
    } catch (err: any) {
      rowErrors.push({ row: 0, file: file.originalname, message: err.message })
    }
  }

  const total = files.length
  const syncLog = await createSyncLog(tenantId, 'CONTPAQ_XML', total)
  await markSyncRunning(syncLog.id)

  let processed = rowErrors.length // archivos que ya fallaron en el parseo
  let inserted  = 0
  let updated   = 0
  let employeesUpserted = 0
  let payrollUpserted   = 0
  const changedEmployees: ChangedEmployee[] = []

  const PROGRESS_EVERY = 10
  const emitProgress = () => {
    io?.to(`tenant:${tenantId}`).emit('sync:progress', { processed, total, errors: rowErrors })
  }
  emitProgress()

  try {
    for (const item of parsed) {
      try {
        const { id: employeeId, outcome } = await upsertEmployee(tenantDb, tenantId, item.employee, 'CONTPAQ_XML')
        if (outcome === 'inserted') inserted++
        else updated++
        employeesUpserted++

        const payrollResult = await upsertPayrollRecord(tenantDb, tenantId, employeeId, item.payroll, 'CONTPAQ_XML')
        payrollUpserted++
        if (payrollResult.netPayChanged && payrollResult.newNetPay != null) {
          changedEmployees.push({ employeeId, newNetPay: payrollResult.newNetPay, previousNetPay: payrollResult.previousNetPay, period: payrollResult.periodLabel, payrollRecordId: payrollResult.payrollRecordId })
        }
      } catch (err: any) {
        rowErrors.push({ row: 0, file: item.file, message: err.message })
      } finally {
        processed++
        if (processed % PROGRESS_EVERY === 0 || processed === total) emitProgress()
      }
    }

    await finishSync(syncLog.id, { processed, errors: rowErrors, employeesProcessed: employeesUpserted, payrollProcessed: payrollUpserted })
    return { processed, inserted, updated, errors: rowErrors, employeesUpserted, payrollUpserted, changedEmployees, syncLogId: syncLog.id }
  } catch (err: any) {
    await failSync(syncLog.id, err.message)
    throw err
  }
}

// ── runDbfSync ────────────────────────────────────────────────
// NOMIPAQ EMPLEA.DBF / NOMINA.DBF -> upsert employees + payroll_records.
// Encoding CP850 (crítico) y filtro de registros @deleted en dbfParser.

async function runDbfSync(tenantId: string, tenantDb: any, io: any, files: SourceFile[]): Promise<SyncResult> {
  const empleaFile = files.find(f => /emplea/i.test(f.originalname))
  const nominaFile = files.find(f => /nomina/i.test(f.originalname))
  if (!empleaFile && !nominaFile) {
    throw new AppError(400, 'Se esperaba EMPLEA.DBF y/o NOMINA.DBF (nombre de archivo no reconocido)')
  }

  const rowErrors: SyncRowError[] = []
  const employeeRows: (EmployeeUpsertRow & { row: number })[] = []
  const payrollRows: (PayrollUpsertRow & { row: number; employee_code: string })[] = []

  if (empleaFile) {
    const { rows, errors } = await parseEmpleaDbf(empleaFile.buffer, empleaFile.originalname)
    employeeRows.push(...rows)
    for (const e of errors) rowErrors.push({ ...e, file: empleaFile.originalname })
  }
  if (nominaFile) {
    const { rows, errors } = await parseNominaDbf(nominaFile.buffer, nominaFile.originalname)
    payrollRows.push(...rows)
    for (const e of errors) rowErrors.push({ ...e, file: nominaFile.originalname })
  }

  const total = employeeRows.length + payrollRows.length
  const syncLog = await createSyncLog(tenantId, 'NOMIPAQ_DBF', total)
  await markSyncRunning(syncLog.id)

  let processed = 0
  let inserted  = 0
  let updated   = 0
  let employeesUpserted = 0
  let payrollUpserted   = 0
  const changedEmployees: ChangedEmployee[] = []

  const PROGRESS_EVERY = 10
  const emitProgress = () => {
    io?.to(`tenant:${tenantId}`).emit('sync:progress', { processed, total, errors: rowErrors })
  }

  try {
    // 1. EMPLEA.DBF primero — crea/actualiza empleados.
    for (const row of employeeRows) {
      try {
        const { outcome } = await upsertEmployee(tenantDb, tenantId, row, 'NOMIPAQ_DBF')
        if (outcome === 'inserted') inserted++
        else updated++
        employeesUpserted++
      } catch (err: any) {
        rowErrors.push({ row: row.row, file: empleaFile?.originalname, message: err.message })
      } finally {
        processed++
        if (processed % PROGRESS_EVERY === 0 || processed === total) emitProgress()
      }
    }

    // 2. NOMINA.DBF — enlaza por employee_code (debe existir ya, de este mismo
    //    archivo EMPLEA.DBF o de una carga previa).
    for (const row of payrollRows) {
      try {
        const found = await tenantDb.$queryRaw<{ id: string }[]>`
          SELECT id FROM employees WHERE tenant_id = ${tenantId} AND employee_code = ${row.employee_code} LIMIT 1
        `
        const employeeId = found[0]?.id
        if (!employeeId) throw new Error(`Empleado con clave "${row.employee_code}" no encontrado`)

        const { row: _r, employee_code: _ec, ...payrollFields } = row
        const payrollResult = await upsertPayrollRecord(tenantDb, tenantId, employeeId, payrollFields, 'NOMIPAQ_DBF')
        payrollUpserted++
        if (payrollResult.netPayChanged && payrollResult.newNetPay != null) {
          changedEmployees.push({ employeeId, newNetPay: payrollResult.newNetPay, previousNetPay: payrollResult.previousNetPay, period: payrollResult.periodLabel, payrollRecordId: payrollResult.payrollRecordId })
        }
      } catch (err: any) {
        rowErrors.push({ row: row.row, file: nominaFile?.originalname, message: err.message })
      } finally {
        processed++
        if (processed % PROGRESS_EVERY === 0 || processed === total) emitProgress()
      }
    }

    await finishSync(syncLog.id, { processed, errors: rowErrors, employeesProcessed: employeesUpserted, payrollProcessed: payrollUpserted })
    return { processed, inserted, updated, errors: rowErrors, employeesUpserted, payrollUpserted, changedEmployees, syncLogId: syncLog.id }
  } catch (err: any) {
    await failSync(syncLog.id, err.message)
    throw err
  }
}

// ── POST /api/connectors/upload/excel ────────────────────────

router.post('/upload/excel', requireHR, handleExcelUpload, async (req: Request, res: Response, next: NextFunction) => {
  const files = (req.files as Express.Multer.File[]) || []
  if (files.length === 0) return next(new AppError(400, 'No se subió ningún archivo'))

  try {
    // El front manda el mapeo COMPLETO (auto-detectado + sugerencias
    // aplicadas + overrides manuales) confirmado en el Step 3 del wizard —
    // se usa tal cual para el import real, garantizando que lo que el
    // usuario vio en el preview sea exactamente lo que se guarda (ver
    // PART 1/4, "Sugerido: X" solo tenía efecto visual antes de esto).
    let fieldMap: Record<string, string> | undefined
    if (typeof req.body.fieldMap === 'string' && req.body.fieldMap) {
      try { fieldMap = JSON.parse(req.body.fieldMap) } catch { /* ignorar mapeo malformado */ }
    }
    if (!fieldMap) {
      fieldMap = (await getSavedFieldMap(req.tenant.id, FIELD_MAP_SOURCE_TYPE)) || undefined
    }

    const result = await runExcelSync(req.tenant.id, req.tenantDb, req.app.get('io'), files, fieldMap)
    await upsertConnectedSource(req.tenantDb, req.tenant.id, 'EXCEL', files)

    // PART 4 — guarda el mapeo efectivamente usado para la próxima subida.
    if (fieldMap) await saveFieldMap(req.tenant.id, FIELD_MAP_SOURCE_TYPE, fieldMap)

    res.json({ processed: result.processed, inserted: result.inserted, updated: result.updated, errors: result.errors, syncLogId: result.syncLogId })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/connectors/upload/cfdi ─────────────────────────

router.post('/upload/cfdi', requireHR, handleCfdiUpload, async (req: Request, res: Response, next: NextFunction) => {
  const files = (req.files as Express.Multer.File[]) || []
  if (files.length === 0) return next(new AppError(400, 'No se subió ningún archivo'))

  try {
    const result = await runCfdiSync(req.tenant.id, req.tenantDb, req.app.get('io'), files)
    await upsertConnectedSource(req.tenantDb, req.tenant.id, 'CFDI', files)
    res.json({ processed: result.processed, inserted: result.inserted, updated: result.updated, errors: result.errors, syncLogId: result.syncLogId })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/connectors/upload/dbf ──────────────────────────

router.post('/upload/dbf', requireHR, handleDbfUpload, async (req: Request, res: Response, next: NextFunction) => {
  const files = (req.files as Express.Multer.File[]) || []
  if (files.length === 0) return next(new AppError(400, 'No se subió ningún archivo'))

  try {
    const result = await runDbfSync(req.tenant.id, req.tenantDb, req.app.get('io'), files)
    await upsertConnectedSource(req.tenantDb, req.tenant.id, 'DBF', files)
    res.json({ processed: result.processed, inserted: result.inserted, updated: result.updated, errors: result.errors, syncLogId: result.syncLogId })
  } catch (err) {
    next(err)
  }
})

// ============================================================
// LIVE-WIRE — connected_sources: persistencia del archivo,
// reload sin re-upload, reemplazo en vivo y auto-sync.
// ============================================================

interface StoredFile { name: string; content: string } // content = base64

function encodeFiles(files: SourceFile[]): { fileName: string; fileContent: string; checksum: string } {
  const stored: StoredFile[] = files.map((f) => ({ name: f.originalname, content: f.buffer.toString('base64') }))
  const fileName = files.length === 1 ? files[0].originalname : `${files[0].originalname} (+${files.length - 1} más)`
  const concatenated = files.map((f) => f.buffer).reduce((a, b) => Buffer.concat([a, b]), Buffer.alloc(0))
  const checksum = crypto.createHash('md5').update(concatenated).digest('hex')
  return { fileName, fileContent: JSON.stringify(stored), checksum }
}

function decodeFiles(fileContent: string): SourceFile[] {
  const stored: StoredFile[] = JSON.parse(fileContent)
  return stored.map((s) => ({ buffer: Buffer.from(s.content, 'base64'), originalname: s.name }))
}

// Guarda (o reemplaza) el archivo conectado para `type`. Para DBF, que puede
// llegar como un solo archivo del par (EMPLEA/NOMINA), conserva el otro
// miembro del par si ya estaba conectado — de lo contrario un "Reemplazar
// archivo" con solo NOMINA.DBF borraría silenciosamente la copia de EMPLEA.DBF.
export async function upsertConnectedSource(tenantDb: any, tenantId: string, type: 'EXCEL' | 'CFDI' | 'DBF', files: SourceFile[]): Promise<void> {
  if (files.length === 0) return

  let finalFiles = files
  if (type === 'DBF') {
    const existingRows = await tenantDb.$queryRaw<{ file_content: string }[]>`
      SELECT file_content FROM connected_sources WHERE tenant_id = ${tenantId} AND type = 'DBF' LIMIT 1
    `
    if (existingRows[0]) {
      const existing = decodeFiles(existingRows[0].file_content)
      const providesEmplea = files.some((f) => /emplea/i.test(f.originalname))
      const providesNomina = files.some((f) => /nomina/i.test(f.originalname))
      const keepEmplea = !providesEmplea ? existing.find((f) => /emplea/i.test(f.originalname)) : undefined
      const keepNomina = !providesNomina ? existing.find((f) => /nomina/i.test(f.originalname)) : undefined
      finalFiles = [...files, ...(keepEmplea ? [keepEmplea] : []), ...(keepNomina ? [keepNomina] : [])]
    }
  }

  const { fileName, fileContent, checksum } = encodeFiles(finalFiles)
  await tenantDb.$executeRaw`
    INSERT INTO connected_sources (tenant_id, type, file_name, file_content, checksum, status, last_error, last_read_at, last_modified_at)
    VALUES (${tenantId}, ${type}, ${fileName}, ${fileContent}, ${checksum}, 'CONNECTED', NULL, NOW(), NOW())
    ON CONFLICT (tenant_id, type) DO UPDATE SET
      file_name        = EXCLUDED.file_name,
      file_content      = EXCLUDED.file_content,
      checksum         = EXCLUDED.checksum,
      status           = 'CONNECTED',
      last_error       = NULL,
      last_read_at     = NOW(),
      last_modified_at = NOW()
  `
}

// Re-corre el ETL sobre el archivo ya almacenado en `connected_sources` y
// propaga los resultados por Socket.io. La usan /reload, /update-file y el
// worker de auto-sync (jobs/autoSyncQueue.ts).
export async function runReloadForSource(tenantId: string, tenantDb: any, io: any, sourceId: string): Promise<SyncResult> {
  const rows = await tenantDb.$queryRaw<any[]>`
    SELECT * FROM connected_sources WHERE id = ${sourceId} AND tenant_id = ${tenantId} LIMIT 1
  `
  const source = rows[0]
  if (!source) throw new AppError(404, 'Conexión no encontrada')

  const files = decodeFiles(source.file_content)

  try {
    let result: SyncResult
    if (source.type === 'EXCEL') {
      // Recargas/auto-sync reusan el mapeo guardado del tenant — no hay
      // sesión de wizard aquí para volver a preguntar.
      const savedMap = (await getSavedFieldMap(tenantId, FIELD_MAP_SOURCE_TYPE)) || undefined
      result = await runExcelSync(tenantId, tenantDb, io, files, savedMap)
    }
    else if (source.type === 'CFDI') result = await runCfdiSync(tenantId, tenantDb, io, files)
    else if (source.type === 'DBF')  result = await runDbfSync(tenantId, tenantDb, io, files)
    else throw new AppError(400, `Tipo de conexión no soportado: ${source.type}`)

    await tenantDb.$executeRaw`
      UPDATE connected_sources SET status = 'CONNECTED', last_error = NULL, last_read_at = NOW() WHERE id = ${sourceId}
    `

    // Propagación Socket.io (admin + colaboradores + notificación in-app) —
    // punto único compartido con el job 'webhook-sync' (ver lib/syncEmitter.ts).
    await emitSyncComplete(tenantId, result)

    return result
  } catch (err: any) {
    await tenantDb.$executeRaw`
      UPDATE connected_sources SET status = 'ERROR', last_error = ${(err.message || 'Error desconocido').slice(0, 500)} WHERE id = ${sourceId}
    `
    throw err
  }
}

// ── GET /api/connectors/agent-status/:tenantId ───────────────
// Heartbeat del agente local (POST /api/webhook/heartbeat o cada sync) —
// TTL de 90s en Redis, ver routes/webhook.ts.

router.get('/agent-status/:tenantId', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.params.tenantId !== req.tenant.id) throw new AppError(403, 'No autorizado para este tenant')

    const raw = await redis.get(`t:${req.tenant.id}:agent:heartbeat`)
    if (!raw) return res.json({ status: 'OFFLINE' })

    const heartbeat = JSON.parse(raw)
    const ageSeconds = Math.round((Date.now() - heartbeat.ts) / 1000)
    if (ageSeconds > 90) return res.json({ status: 'OFFLINE' }) // por si el reloj del agente difiere del TTL de Redis

    res.json({ status: 'ACTIVE', ...heartbeat, ageSeconds })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/connectors/download-agent/:tenantId ─────────────
// Genera un .zip con config.json pre-llenado + instrucciones — todo lo que
// el cliente necesita para correr el agente en su máquina.

router.get('/download-agent/:tenantId', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.params.tenantId !== req.tenant.id) throw new AppError(403, 'No autorizado para este tenant')

    const tenant = await prismaPublic.tenant.findUnique({ where: { id: req.tenant.id }, select: { slug: true } })
    if (!tenant) throw new AppError(404, 'Tenant no encontrado')

    const config = {
      apiUrl:        process.env.AGENT_API_URL || 'http://localhost:3001',
      tenantId:      req.tenant.id,
      webhookSecret: process.env.WEBHOOK_SECRET || 'codice_webhook_secret_dev',
      agentVersion:  '0.1.0',
      sources: [
        { type: 'EXCEL', watchPath: './watch/nomina.xlsx', enabled: true },
        { type: 'DBF',   watchPath: './watch/', files: ['EMPLEA.DBF', 'NOMINA.DBF'], enabled: false },
      ],
      debounceMs:               3000,
      heartbeatIntervalSeconds: 60,
    }

    const readme =
      'CÓDICE Agent — Instrucciones\n\n' +
      '1. Edita config.json con tu ruta.\n' +
      '2. Ejecuta codice-agent.exe.\n' +
      '3. Listo.\n'

    const installServiceBat =
      'sc create "CODICE Agent" binPath= "%~dp0codice-agent.exe"\n' +
      'sc description "CODICE Agent" "Sincronizacion automatica CODICE"\n' +
      'sc start "CODICE Agent"\n'

    res.attachment(`codice-agent-${tenant.slug}.zip`)
    const archive = archiver('zip', { zlib: { level: 9 } })
    archive.on('error', (err) => next(err))
    archive.pipe(res)
    archive.append(JSON.stringify(config, null, 2), { name: 'config.json' })
    archive.append(readme, { name: 'README.txt' })
    archive.append(installServiceBat, { name: 'install-service.bat' })
    await archive.finalize()
  } catch (err) {
    next(err)
  }
})

// ── GET /api/connectors/sources ──────────────────────────────
// Conexiones activas del tenant, para la card "Archivo conectado" rediseñada.

router.get('/sources', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const rows = await req.tenantDb.$queryRaw<any[]>`
      SELECT
        id, type, file_name AS "fileName", checksum, status, last_error AS "lastError",
        auto_sync AS "autoSync", sync_interval_minutes AS "syncIntervalMinutes",
        last_read_at AS "lastReadAt", last_modified_at AS "lastModifiedAt"
      FROM connected_sources
      WHERE tenant_id = ${tenantId}
      ORDER BY type
    `
    res.json({ data: rows })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/connectors/:sourceId/reload ────────────────────
// Re-corre el ETL sin pedir un nuevo archivo — "el archivo es la fuente de verdad".

router.post('/:sourceId/reload', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await runReloadForSource(req.tenant.id, req.tenantDb, req.app.get('io'), req.params.sourceId)
    res.json({ processed: result.processed, inserted: result.inserted, updated: result.updated, errors: result.errors, syncLogId: result.syncLogId })
  } catch (err) {
    next(err)
  }
})

// ── PATCH /api/connectors/:sourceId/update-file ──────────────
// "Cambia un número y velo en vivo": reemplaza el archivo conectado y
// dispara un reload automático.

router.patch('/:sourceId/update-file', requireHR, handleReplaceUpload, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const files = (req.files as Express.Multer.File[]) || []
    if (files.length === 0) throw new AppError(400, 'No se subió ningún archivo')

    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb
    const sourceId = req.params.sourceId

    const rows = await tenantDb.$queryRaw<any[]>`
      SELECT id, type FROM connected_sources WHERE id = ${sourceId} AND tenant_id = ${tenantId} LIMIT 1
    `
    const source = rows[0]
    if (!source) throw new AppError(404, 'Conexión no encontrada')

    const allowedExt = EXT_BY_SOURCE_TYPE[source.type]
    for (const f of files) {
      const ext = path.extname(f.originalname).toLowerCase()
      if (!allowedExt?.has(ext)) {
        throw new AppError(400, `"${f.originalname}" no corresponde al tipo de conexión ${source.type}`)
      }
    }

    await upsertConnectedSource(tenantDb, tenantId, source.type, files)
    const result = await runReloadForSource(tenantId, tenantDb, req.app.get('io'), sourceId)
    res.json({ processed: result.processed, inserted: result.inserted, updated: result.updated, errors: result.errors, syncLogId: result.syncLogId })
  } catch (err) {
    next(err)
  }
})

// ── PATCH /api/connectors/:sourceId/auto-sync ────────────────
// Activa/desactiva y configura el intervalo de auto-sync (BullMQ).

const autoSyncSchema = z.object({
  autoSync:             z.boolean(),
  syncIntervalMinutes:  z.number().int().min(1).max(1440).optional(),
})

router.patch('/:sourceId/auto-sync', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { autoSync, syncIntervalMinutes } = autoSyncSchema.parse(req.body)
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb
    const sourceId = req.params.sourceId

    const rows = await tenantDb.$queryRaw<{ id: string }[]>`
      SELECT id FROM connected_sources WHERE id = ${sourceId} AND tenant_id = ${tenantId} LIMIT 1
    `
    if (!rows[0]) throw new AppError(404, 'Conexión no encontrada')

    const interval = syncIntervalMinutes ?? 15
    await tenantDb.$executeRaw`
      UPDATE connected_sources SET auto_sync = ${autoSync}, sync_interval_minutes = ${interval} WHERE id = ${sourceId}
    `

    if (autoSync) await registerAutoSync(sourceId, tenantId, interval)
    else await unregisterAutoSync(sourceId)

    res.json({ ok: true, autoSync, syncIntervalMinutes: interval })
  } catch (err) {
    next(err)
  }
})

// ============================================================
// CONTROL TOTAL DE FUENTES — pausar/reanudar, desconectar,
// desconectar y limpiar. Todas emiten 'connectors:changed' al
// tenant para que la página de Conectores se refresque sola
// aunque el cambio venga de otra pestaña/admin.
// ============================================================

function emitConnectorsChanged(io: any, tenantId: string, sourceId: string, action: string) {
  io?.to(`tenant:${tenantId}`).emit('connectors:changed', { sourceId, action })
}

async function findConnectedSourceOr404(tenantDb: any, tenantId: string, sourceId: string) {
  const rows = await tenantDb.$queryRaw<any[]>`
    SELECT * FROM connected_sources WHERE id = ${sourceId} AND tenant_id = ${tenantId} LIMIT 1
  `
  if (!rows[0]) throw new AppError(404, 'Conexión no encontrada')
  return rows[0]
}

// connected_sources.type -> payroll_records.source, para poder borrar
// exactamente los recibos que vinieron de ESTE tipo de conexión. Como solo
// se permite una conexión activa por tipo (upsert por (tenant_id, type) —
// ver upsertConnectedSource), esto equivale a "todo lo que importó este source".
const SOURCE_TYPE_TO_PAYROLL_SOURCE: Record<string, string> = {
  EXCEL: 'EXCEL_GENERIC',
  DBF:   'NOMIPAQ_DBF',
  CFDI:  'CONTPAQ_XML',
}

// ── PATCH /api/connectors/sources/:sourceId/pause ────────────
// Desactiva el auto-sync SIN desconectar — el archivo sigue disponible
// para "Recargar ahora" manual, solo se detiene la corrida automática.

router.patch('/sources/:sourceId/pause', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb
    const sourceId = req.params.sourceId

    await findConnectedSourceOr404(tenantDb, tenantId, sourceId)
    await tenantDb.$executeRaw`UPDATE connected_sources SET auto_sync = false WHERE id = ${sourceId}`
    await unregisterAutoSync(sourceId)

    emitConnectorsChanged(req.app.get('io'), tenantId, sourceId, 'paused')
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// ── PATCH /api/connectors/sources/:sourceId/resume ───────────
// Reactiva el auto-sync con el intervalo ya configurado (o 15 min si nunca
// se configuró uno).

router.patch('/sources/:sourceId/resume', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb
    const sourceId = req.params.sourceId

    const source = await findConnectedSourceOr404(tenantDb, tenantId, sourceId)
    const interval = source.sync_interval_minutes ?? 15

    await tenantDb.$executeRaw`UPDATE connected_sources SET auto_sync = true, sync_interval_minutes = ${interval} WHERE id = ${sourceId}`
    await registerAutoSync(sourceId, tenantId, interval)

    emitConnectorsChanged(req.app.get('io'), tenantId, sourceId, 'resumed')
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// ── DELETE /api/connectors/sources/:sourceId ─────────────────
// Desconecta la fuente (borra connected_sources) — NO toca employees ni
// payroll_records ya importados.

router.delete('/sources/:sourceId', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb
    const sourceId = req.params.sourceId

    await findConnectedSourceOr404(tenantDb, tenantId, sourceId)
    await unregisterAutoSync(sourceId)
    await tenantDb.$executeRaw`DELETE FROM connected_sources WHERE id = ${sourceId} AND tenant_id = ${tenantId}`

    emitConnectorsChanged(req.app.get('io'), tenantId, sourceId, 'disconnected')
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// ── DELETE /api/connectors/sources/:sourceId/with-data ───────
// Desconecta la fuente Y borra los payroll_records que importó — requiere
// ?confirm=true explícito (acción destructiva, sin deshacer).

router.delete('/sources/:sourceId/with-data', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.query.confirm !== 'true') {
      throw new AppError(400, 'Se requiere ?confirm=true para esta acción — borra recibos de nómina permanentemente')
    }

    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb
    const sourceId = req.params.sourceId

    const source = await findConnectedSourceOr404(tenantDb, tenantId, sourceId)
    const payrollSource = SOURCE_TYPE_TO_PAYROLL_SOURCE[source.type]

    let deletedPayroll = 0
    if (payrollSource) {
      const deleted = await tenantDb.$queryRaw<{ id: string }[]>`
        DELETE FROM payroll_records WHERE tenant_id = ${tenantId} AND source = ${payrollSource} RETURNING id
      `
      deletedPayroll = deleted.length
    }

    await unregisterAutoSync(sourceId)
    await tenantDb.$executeRaw`DELETE FROM connected_sources WHERE id = ${sourceId} AND tenant_id = ${tenantId}`

    const io = req.app.get('io')
    emitConnectorsChanged(io, tenantId, sourceId, 'disconnected_with_data')
    io?.to(`tenant:${tenantId}`).emit('headcount:refresh', {})

    res.json({ deleted: { source: 1, payrollRecords: deletedPayroll } })
  } catch (err) {
    next(err)
  }
})

// ── Upsert de un empleado en el schema del tenant ────────────
// Match: rfc primero, luego employee_code, luego insert.
// `tenantDb` ya tiene el search_path apuntando al schema del tenant
// (ver middleware/tenant.ts) — `employees` referencia esa tabla sin calificar.

async function upsertEmployee(
  tenantDb: any,
  tenantId: string,
  row: EmployeeUpsertRow,
  source: string
): Promise<{ id: string; outcome: 'inserted' | 'updated' }> {
  let existingId: string | undefined

  if (row.rfc) {
    const found = await tenantDb.$queryRaw<{ id: string }[]>`
      SELECT id FROM employees WHERE tenant_id = ${tenantId} AND rfc = ${row.rfc} LIMIT 1
    `
    existingId = found[0]?.id
  }

  if (!existingId && row.employee_code) {
    const found = await tenantDb.$queryRaw<{ id: string }[]>`
      SELECT id FROM employees WHERE tenant_id = ${tenantId} AND employee_code = ${row.employee_code} LIMIT 1
    `
    existingId = found[0]?.id
  }

  const presentFields = WRITABLE_EMPLOYEE_COLUMNS
    .map(col => [col, row[col]] as const)
    .filter(([, value]) => value !== undefined)

  if (existingId) {
    const setFragments = presentFields.map(([col, value]) => Prisma.sql`${Prisma.raw(col)} = ${value}`)
    setFragments.push(Prisma.sql`${Prisma.raw('source')} = ${source}`)

    await tenantDb.$executeRaw`
      UPDATE employees SET ${Prisma.join(setFragments, ', ')} WHERE id = ${existingId}
    `
    return { id: existingId, outcome: 'updated' }
  }

  if (!row.first_name || !row.last_name) {
    throw new Error('Falta nombre completo para dar de alta al empleado')
  }

  const columns = [...presentFields.map(([col]) => col), 'tenant_id', 'source']
  const values: unknown[]  = [...presentFields.map(([, value]) => value), tenantId, source]

  const columnFragment = Prisma.join(columns.map(c => Prisma.raw(c)), ', ')
  const valueFragment  = Prisma.join(values, ', ')

  const inserted = await tenantDb.$queryRaw<{ id: string }[]>`
    INSERT INTO employees (${columnFragment}) VALUES (${valueFragment}) RETURNING id
  `
  return { id: inserted[0].id, outcome: 'inserted' }
}

// ── Upsert de un recibo de nómina en el schema del tenant ────
// Match: uuid_sat (timbre fiscal) si está presente. Si no (DBF legacy sin
// timbrado), matchea por (employee_id, period_start, period_end) — así un
// reload del MISMO archivo para el mismo período ACTUALIZA el recibo en
// vez de duplicarlo, que es justo lo que permite que "Recargar ahora"
// converja en lugar de acumular registros en cada re-lectura.

async function upsertPayrollRecord(
  tenantDb: any,
  tenantId: string,
  employeeId: string,
  row: PayrollUpsertRow,
  source: string
): Promise<{ outcome: 'inserted' | 'updated'; netPayChanged: boolean; newNetPay: number | null; previousNetPay: number | null; periodLabel: string | null; payrollRecordId: string }> {
  let existingId: string | undefined
  let previousNetPay: number | null = null

  if (row.uuid_sat) {
    const found = await tenantDb.$queryRaw<{ id: string; net_pay: any }[]>`
      SELECT id, net_pay FROM payroll_records WHERE tenant_id = ${tenantId} AND uuid_sat = ${row.uuid_sat} LIMIT 1
    `
    existingId = found[0]?.id
    if (found[0]) previousNetPay = Number(found[0].net_pay)
  }

  if (!existingId && !row.uuid_sat && row.period_start && row.period_end) {
    // Cast explícito ::date en el parámetro: `row.period_start` es un JS Date
    // a medianoche LOCAL (parseDbfDate), que Prisma serializa como
    // timestamptz — sin el cast, Postgres compara esa marca de tiempo (no
    // medianoche UTC si el servidor no está en UTC) contra la columna DATE
    // "elevada" a medianoche UTC, y nunca hacen match aunque representen el
    // mismo día calendario. Confirmado con datos reales: sin el cast, dos
    // reloads del mismo archivo duplicaban el recibo en vez de actualizarlo.
    const found = await tenantDb.$queryRaw<{ id: string; net_pay: any }[]>`
      SELECT id, net_pay FROM payroll_records
      WHERE tenant_id = ${tenantId} AND employee_id = ${employeeId}
        AND period_start = ${row.period_start}::date AND period_end = ${row.period_end}::date
      LIMIT 1
    `
    existingId = found[0]?.id
    if (found[0]) previousNetPay = Number(found[0].net_pay)
  }

  // Excel genérico sin folio/UUID fiscal ni un rango period_start/period_end
  // confiable (la fila trae "período"/"año" como texto libre, no fechas) —
  // (employee_id, period_label, payment_date) es la llave de convergencia
  // para que un reload del mismo archivo actualice el mismo recibo.
  if (!existingId && !row.uuid_sat && row.period_label && row.payment_date) {
    const found = await tenantDb.$queryRaw<{ id: string; net_pay: any }[]>`
      SELECT id, net_pay FROM payroll_records
      WHERE tenant_id = ${tenantId} AND employee_id = ${employeeId}
        AND period_label = ${row.period_label} AND payment_date = ${row.payment_date}::date
      LIMIT 1
    `
    existingId = found[0]?.id
    if (found[0]) previousNetPay = Number(found[0].net_pay)
  }

  const presentFields = WRITABLE_PAYROLL_COLUMNS
    .map(col => [col, row[col]] as const)
    .filter(([, value]) => value !== undefined)

  const periodLabel = row.period_label
    ?? (row.period_start instanceof Date ? row.period_start.toISOString().slice(0, 10) : null)

  if (existingId) {
    const setFragments = presentFields.map(([col, value]) => Prisma.sql`${Prisma.raw(col)} = ${value}`)
    setFragments.push(Prisma.sql`${Prisma.raw('source')} = ${source}`)

    await tenantDb.$executeRaw`
      UPDATE payroll_records SET ${Prisma.join(setFragments, ', ')} WHERE id = ${existingId}
    `

    // El recibo cambió — la explicación de IA cacheada (payroll.ts) ya no aplica.
    await redis.del(`t:${tenantId}:ai:payroll:${existingId}`)

    const newNetPay = row.net_pay !== undefined ? Number(row.net_pay) : previousNetPay
    const netPayChanged = row.net_pay !== undefined && previousNetPay !== null && Number(row.net_pay) !== previousNetPay
    return { outcome: 'updated', netPayChanged, newNetPay, previousNetPay, periodLabel, payrollRecordId: existingId }
  }

  const columns = [...presentFields.map(([col]) => col), 'employee_id', 'tenant_id', 'source']
  const values: unknown[]  = [...presentFields.map(([, value]) => value), employeeId, tenantId, source]

  const columnFragment = Prisma.join(columns.map(c => Prisma.raw(c)), ', ')
  const valueFragment  = Prisma.join(values, ', ')

  const inserted = await tenantDb.$queryRaw<{ id: string }[]>`
    INSERT INTO payroll_records (${columnFragment}) VALUES (${valueFragment}) RETURNING id
  `
  return { outcome: 'inserted', netPayChanged: false, newNetPay: row.net_pay ?? null, previousNetPay: null, periodLabel, payrollRecordId: inserted[0].id }
}

export default router

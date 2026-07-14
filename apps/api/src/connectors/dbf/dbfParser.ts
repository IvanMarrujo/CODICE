// ============================================================
// CÓDICE · NOMIPAQ connector — parser DBF (EMPLEA.DBF / NOMINA.DBF)
// Parseo puro: buffer DBF -> filas canónicas. Sin acceso a DB.
// Encoding CP850 es crítico: Nomipaq exporta en DOS Latin US, y el
// default de dbffile (ISO-8859-1) corrompe acentos y "ñ".
// ============================================================

import { DBFFile, DELETED } from 'dbffile'
import * as fs   from 'fs'
import * as os   from 'os'
import * as path from 'path'
import { EmployeeUpsertRow, PayrollUpsertRow } from '../common'
import { mapDbfHeaders, DbfCanonicalField } from './dbfFieldMapper'

const CP850 = 'cp850'

export interface RowError {
  row:     number
  message: string
}

export interface ParsedDbfEmployees {
  rows:   (EmployeeUpsertRow & { row: number })[]
  errors: RowError[]
}

export interface ParsedDbfPayroll {
  rows:   (PayrollUpsertRow & { row: number; employee_code: string })[]
  errors: RowError[]
}

async function withTempFile<T>(buffer: Buffer, filename: string, fn: (path: string) => Promise<T>): Promise<T> {
  const tmpPath = path.join(os.tmpdir(), `codice-dbf-${Date.now()}-${Math.random().toString(36).slice(2)}-${path.basename(filename)}`)
  fs.writeFileSync(tmpPath, buffer)
  try {
    return await fn(tmpPath)
  } finally {
    fs.unlink(tmpPath, () => {}) // best-effort, no bloquea la respuesta
  }
}

function toNumber(v: unknown): number | undefined {
  if (v == null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/** Crítico: exports legacy suelen guardar la fecha como texto/numérico YYYYMMDD, no como tipo Date nativo de DBF. */
function parseDbfDate(v: unknown): Date | undefined {
  if (v == null || v === '') return undefined
  if (v instanceof Date) return isNaN(v.getTime()) ? undefined : v
  const str = String(v).trim()
  if (/^\d{8}$/.test(str)) {
    const y = Number(str.slice(0, 4)), m = Number(str.slice(4, 6)), d = Number(str.slice(6, 8))
    const date = new Date(y, m - 1, d)
    return isNaN(date.getTime()) ? undefined : date
  }
  const d = new Date(str)
  return isNaN(d.getTime()) ? undefined : d
}

function extractValues(
  record: Record<string, unknown>,
  columnMap: Map<string, DbfCanonicalField>
): Partial<Record<DbfCanonicalField, unknown>> {
  const values: Partial<Record<DbfCanonicalField, unknown>> = {}
  for (const [fieldName, canonical] of columnMap.entries()) {
    const v = record[fieldName]
    if (v !== undefined && v !== null && String(v).trim() !== '') values[canonical] = v
  }
  return values
}

// ── EMPLEA.DBF -> employees ──────────────────────────────────

export async function parseEmpleaDbf(buffer: Buffer, filename: string): Promise<ParsedDbfEmployees> {
  return withTempFile(buffer, filename, async (tmpPath) => {
    let dbf: DBFFile
    try {
      dbf = await DBFFile.open(tmpPath, { encoding: CP850, readMode: 'loose' })
    } catch (err: any) {
      return { rows: [], errors: [{ row: 0, message: `No se pudo leer "${filename}": ${err.message}` }] }
    }

    const columnMap = mapDbfHeaders(dbf.fields.map(f => f.name))
    const rows: (EmployeeUpsertRow & { row: number })[] = []
    const errors: RowError[] = []

    const records = await dbf.readRecords() // includeDeletedRecords: false por default -> ya excluye @deleted
    records.forEach((record, idx) => {
      const rowNumber = idx + 1
      if ((record as any)[DELETED]) return // filtro explícito adicional de @deleted, por robustez

      try {
        const values = extractValues(record, columnMap)
        if (Object.keys(values).length === 0) return

        const row: EmployeeUpsertRow & { row: number } = { row: rowNumber }

        const paterno = values.apellido_paterno ? String(values.apellido_paterno).trim() : ''
        const materno = values.apellido_materno ? String(values.apellido_materno).trim() : ''
        const lastName = [paterno, materno].filter(Boolean).join(' ')

        if (values.first_name != null) row.first_name = String(values.first_name).trim()
        if (lastName) row.last_name = lastName
        if (values.employee_code != null) row.employee_code = String(values.employee_code).trim()
        if (values.rfc != null)  row.rfc  = String(values.rfc).trim().toUpperCase()
        if (values.curp != null) row.curp = String(values.curp).trim().toUpperCase()
        if (values.nss != null)  row.nss  = String(values.nss).trim()
        if (values.department != null)    row.department    = String(values.department).trim()
        if (values.position != null)      row.position      = String(values.position).trim()
        if (values.plant != null)         row.plant         = String(values.plant).trim()
        if (values.shift != null)         row.shift         = String(values.shift).trim()
        if (values.contract_type != null) row.contract_type = String(values.contract_type).trim()
        if (values.status != null)        row.status        = String(values.status).trim()

        if (values.daily_salary != null) {
          const n = toNumber(values.daily_salary)
          if (n === undefined) throw new Error(`Salario inválido: "${values.daily_salary}"`)
          row.daily_salary = n
        }
        if (values.hire_date != null) {
          const d = parseDbfDate(values.hire_date)
          if (d === undefined) throw new Error(`Fecha de ingreso inválida: "${values.hire_date}"`)
          row.hire_date = d
        }

        if (!row.first_name && !row.employee_code) throw new Error('Falta nombre o clave de empleado')
        rows.push(row)
      } catch (err: any) {
        errors.push({ row: rowNumber, message: err.message })
      }
    })

    return { rows, errors }
  })
}

// ── NOMINA.DBF -> payroll_records (unido a employees por employee_code) ─

export async function parseNominaDbf(buffer: Buffer, filename: string): Promise<ParsedDbfPayroll> {
  return withTempFile(buffer, filename, async (tmpPath) => {
    let dbf: DBFFile
    try {
      dbf = await DBFFile.open(tmpPath, { encoding: CP850, readMode: 'loose' })
    } catch (err: any) {
      return { rows: [], errors: [{ row: 0, message: `No se pudo leer "${filename}": ${err.message}` }] }
    }

    const columnMap = mapDbfHeaders(dbf.fields.map(f => f.name))
    const rows: (PayrollUpsertRow & { row: number; employee_code: string })[] = []
    const errors: RowError[] = []

    const records = await dbf.readRecords()
    records.forEach((record, idx) => {
      const rowNumber = idx + 1
      if ((record as any)[DELETED]) return

      try {
        const values = extractValues(record, columnMap)
        if (Object.keys(values).length === 0) return
        if (values.employee_code == null) throw new Error('Falta clave de empleado (CVE_EMP)')

        const row: PayrollUpsertRow & { row: number; employee_code: string } = {
          row:           rowNumber,
          employee_code: String(values.employee_code).trim(),
          payroll_type:  'Quincenal',
        }
        if (values.folio != null) row.folio = String(values.folio).trim()
        if (values.payment_date != null) row.payment_date = parseDbfDate(values.payment_date)
        if (values.period_start != null) row.period_start = parseDbfDate(values.period_start)
        if (values.period_end != null)   row.period_end   = parseDbfDate(values.period_end)
        if (values.days_paid != null)        row.days_paid        = toNumber(values.days_paid)
        if (values.total_income != null)     row.total_income     = toNumber(values.total_income)
        if (values.total_deductions != null) row.total_deductions = toNumber(values.total_deductions)
        if (values.net_pay != null)          row.net_pay          = toNumber(values.net_pay)
        if (values.isr != null)              row.isr              = toNumber(values.isr)
        if (values.imss_employee != null)    row.imss_employee    = toNumber(values.imss_employee)

        rows.push(row)
      } catch (err: any) {
        errors.push({ row: rowNumber, message: err.message })
      }
    })

    return { rows, errors }
  })
}

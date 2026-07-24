// ============================================================
// CÓDICE · Zoho People — endpoints
// A diferencia de Excel/CFDI/DBF (upload de archivo), Zoho es un conector
// "vivo": no hay un file buffer que guardar — connected_sources solo
// registra METADATA de la conexión (para que "Archivo conectado"/Historial
// tengan algo consistente que mostrar), el dato real siempre viene de la
// API de Zoho en cada sync.
// ============================================================

import { Router, Request, Response, NextFunction } from 'express'
import * as crypto from 'crypto'
import { z } from 'zod'
import { requireHR } from '../middleware/auth'
import { AppError } from '../lib/errors'
import {
  ZohoCredentials, ZohoSyncResult, ZohoSyncChange, ZohoSyncRowError, ZOHO_FIELD_MAP,
  getZohoCredentials, saveZohoCredentials, deleteZohoCredentials,
  fetchAllZohoEmployees, mapZohoRecordToEmployee, testZohoConnection,
} from '../connectors/zoho/zohoConnector'
import { upsertEmployee } from './connectors'
import { queueZohoSync } from '../jobs/zohoSyncQueue'

const router = Router()

const SOURCE = 'ZOHO'

// ── connected_sources: solo metadata (sin archivo real que guardar) ──

async function upsertZohoConnectedSource(tenantDb: any, tenantId: string, dataCenter: string): Promise<void> {
  const fileName = 'Zoho People (API)'
  const fileContent = JSON.stringify({ dataCenter, connectedAt: new Date().toISOString() })
  const checksum = crypto.createHash('md5').update(`${tenantId}:zoho:${dataCenter}`).digest('hex')

  await tenantDb.$executeRaw`
    INSERT INTO connected_sources (tenant_id, type, file_name, file_content, checksum, status, last_error, last_read_at, last_modified_at)
    VALUES (${tenantId}, ${SOURCE}, ${fileName}, ${fileContent}, ${checksum}, 'CONNECTED', NULL, NOW(), NOW())
    ON CONFLICT (tenant_id, type) DO UPDATE SET
      file_name        = EXCLUDED.file_name,
      file_content     = EXCLUDED.file_content,
      checksum         = EXCLUDED.checksum,
      status           = 'CONNECTED',
      last_error       = NULL,
      last_modified_at = NOW()
  `
}

async function markZohoSourceSynced(tenantDb: any, tenantId: string, status: 'CONNECTED' | 'ERROR', lastError: string | null): Promise<void> {
  await tenantDb.$executeRaw`
    UPDATE connected_sources SET status = ${status}, last_error = ${lastError}, last_read_at = NOW()
    WHERE tenant_id = ${tenantId} AND type = ${SOURCE}
  `
}

// ── POST /api/connectors/zoho/connect ────────────────────────

const connectSchema = z.object({
  clientId:     z.string().min(1),
  clientSecret: z.string().min(1),
  refreshToken: z.string().min(1),
  dataCenter:   z.enum(['com', 'eu', 'in']),
})

router.post('/connect', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = connectSchema.parse(req.body)
    const tenantId = req.tenant.id
    const creds: ZohoCredentials = { ...input }

    let employeeCount: number
    let sample: ReturnType<typeof mapZohoRecordToEmployee>[]
    try {
      ({ employeeCount, sample } = await testZohoConnection(tenantId, creds))
    } catch (err: any) {
      throw new AppError(400, `Credenciales inválidas o sin permisos: ${err.message}`)
    }

    // testZohoConnection ya dejó guardado en Redis un token vigente (ver
    // ensureAccessToken) — se re-guarda aquí solo para asegurar que las
    // credenciales base (client id/secret/refresh token tal cual las mandó
    // el usuario) queden persistidas incluso si por algún motivo no hubo
    // refresh de por medio.
    await saveZohoCredentials(tenantId, creds)
    await upsertZohoConnectedSource(req.tenantDb, tenantId, input.dataCenter)

    res.json({ connected: true, employeeCount, sample: sample.slice(0, 3) })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/connectors/zoho/preview ─────────────────────────
// Dry-run: trae TODOS los empleados de Zoho ya mapeados (misma forma que
// GET /api/connectors/preview/excel) — el wizard de conectores (Mapeo/Vista
// previa/Confirmar) lo consume tal cual vía sourceType="ZOHO"/externalData,
// sin cambios en esos steps. El mapeo Zoho -> CÓDICE es FIJO (no hay
// aliases que auto-detectar ni columnas que el usuario deba decidir) — cada
// header ya llega con `field` resuelto.

router.get('/preview', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const creds = await getZohoCredentials(tenantId)
    if (!creds) throw new AppError(400, 'Zoho People no está conectado')

    const records = await fetchAllZohoEmployees(tenantId, creds)
    const mapped = records.map(mapZohoRecordToEmployee)

    const headers = ZOHO_FIELD_MAP.map((f, index) => ({
      index, label: f.label, field: f.canonicalField, fieldLabel: f.label, customLabel: null, suggestion: null,
    }))
    const missingIdentifierCount = mapped.filter((r) => !r.employee_code).length

    res.json({
      headers, preview: mapped.slice(0, 10), totalRows: mapped.length,
      errors: [], missingIdentifierCount, usingSavedMapping: false,
    })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/connectors/zoho/sync ───────────────────────────

router.post('/sync', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const creds = await getZohoCredentials(tenantId)
    if (!creds) throw new AppError(400, 'Zoho People no está conectado')

    const jobId = await queueZohoSync(tenantId)
    res.json({ jobId, status: 'queued' })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/connectors/zoho/status ──────────────────────────

router.get('/status', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb

    const creds = await getZohoCredentials(tenantId)
    const sourceRows = await tenantDb.$queryRaw<{ last_read_at: Date | null; status: string }[]>`
      SELECT last_read_at, status FROM connected_sources WHERE tenant_id = ${tenantId} AND type = ${SOURCE} LIMIT 1
    `
    const [{ count }] = await tenantDb.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM employees WHERE tenant_id = ${tenantId} AND source = ${SOURCE}
    `

    res.json({
      connected:     !!creds && sourceRows[0]?.status !== 'DISCONNECTED',
      lastSync:      sourceRows[0]?.last_read_at ?? null,
      employeeCount: count,
    })
  } catch (err) {
    next(err)
  }
})

// ── DELETE /api/connectors/zoho/disconnect ───────────────────

router.delete('/disconnect', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    await deleteZohoCredentials(tenantId)
    await req.tenantDb.$executeRaw`
      UPDATE connected_sources SET status = 'DISCONNECTED' WHERE tenant_id = ${tenantId} AND type = ${SOURCE}
    `
    res.json({ disconnected: true })
  } catch (err) {
    next(err)
  }
})

// ── Orquestación del sync real (llamada por el worker de zohoSyncQueue) ──
// No vive en zohoConnector.ts (que se mantiene "puro": fetch + mapeo, sin
// tocar DB) — mismo criterio que runExcelSync/runCfdiSync/runDbfSync viven
// en routes/connectors.ts y no en connectors/excel|cfdi|dbf.

export async function runZohoSync(tenantId: string, tenantDb: any, io: any): Promise<ZohoSyncResult> {
  const errors: ZohoSyncRowError[] = []
  const changes: ZohoSyncChange[] = []
  let inserted = 0
  let updated = 0

  const creds = await getZohoCredentials(tenantId)
  if (!creds) {
    await markZohoSourceSynced(tenantDb, tenantId, 'ERROR', 'Zoho People no está conectado')
    return { processed: 0, inserted: 0, updated: 0, errors: [{ message: 'Zoho People no está conectado' }], changes: [] }
  }

  try {
    const records = await fetchAllZohoEmployees(tenantId, creds)

    for (const raw of records) {
      const row = mapZohoRecordToEmployee(raw)
      const zohoId = String(raw['Employee_ID'] ?? '')
      try {
        const { id, outcome } = await upsertEmployee(tenantDb, tenantId, row, SOURCE)
        if (outcome === 'inserted') inserted++
        else updated++
        changes.push({ employeeId: id, outcome })
      } catch (err: any) {
        errors.push({ employeeId: zohoId, message: err.message })
      }
    }

    const allFailed = records.length > 0 && errors.length === records.length
    await markZohoSourceSynced(
      tenantDb, tenantId,
      allFailed ? 'ERROR' : 'CONNECTED',
      errors.length > 0 ? `${errors.length} registro(s) con error` : null,
    )
  } catch (err: any) {
    await markZohoSourceSynced(tenantDb, tenantId, 'ERROR', err.message)
    errors.push({ message: err.message })
  }

  const result: ZohoSyncResult = { processed: inserted + updated, inserted, updated, errors, changes }

  io?.to(`tenant:${tenantId}`).emit('sync:complete', {
    processed: result.processed, updated: result.updated, errors: result.errors, timestamp: new Date().toISOString(),
  })
  io?.to(`tenant:${tenantId}`).emit('headcount:refresh', {})

  return result
}

export default router

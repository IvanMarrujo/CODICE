// ============================================================
// CÓDICE · Odoo — endpoints
// Conector "vivo" (JSON-RPC en cada sync) — mismo modelo que Zoho/Monday:
// connected_sources solo guarda METADATA, nunca un archivo real.
// ============================================================

import { Router, Request, Response, NextFunction } from 'express'
import * as crypto from 'crypto'
import { z } from 'zod'
import { requireHR } from '../middleware/auth'
import { AppError } from '../lib/errors'
import {
  OdooCredentials, ODOO_FIELD_MAP,
  getOdooCredentials, saveOdooCredentials, deleteOdooCredentials,
  encryptPassword, authenticateOdoo, fetchOdooVersion,
  fetchAllOdooEmployees, mapOdooRecordToEmployee,
} from '../connectors/odoo/odooConnector'
import { upsertEmployee } from './connectors'
import { queueOdooSync } from '../jobs/odooSyncQueue'

const router = Router()

const SOURCE = 'ODOO'

interface OdooSyncRowError { employeeId?: string; message: string }
interface OdooSyncResult   { processed: number; inserted: number; updated: number; errors: OdooSyncRowError[] }

// ── connected_sources: solo metadata (sin archivo real que guardar) ──

async function upsertOdooConnectedSource(tenantDb: any, tenantId: string, url: string, database: string): Promise<void> {
  const fileName = 'Odoo ERP (API)'
  const fileContent = JSON.stringify({ url, database, connectedAt: new Date().toISOString() })
  const checksum = crypto.createHash('md5').update(`${tenantId}:odoo:${url}:${database}`).digest('hex')

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

async function markOdooSourceSynced(tenantDb: any, tenantId: string, status: 'CONNECTED' | 'ERROR', lastError: string | null): Promise<void> {
  await tenantDb.$executeRaw`
    UPDATE connected_sources SET status = ${status}, last_error = ${lastError}, last_read_at = NOW()
    WHERE tenant_id = ${tenantId} AND type = ${SOURCE}
  `
}

// ── POST /api/connectors/odoo/connect ────────────────────────

const connectSchema = z.object({
  url:      z.string().min(1),
  database: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
})

router.post('/connect', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = connectSchema.parse(req.body)
    const tenantId = req.tenant.id

    let uid: number
    let employeeCount: number
    try {
      uid = await authenticateOdoo(input.url, input.database, input.username, input.password)
      const creds: OdooCredentials = { url: input.url, database: input.database, username: input.username, password: encryptPassword(input.password), uid }
      const employees = await fetchAllOdooEmployees(creds)
      employeeCount = employees.length
      await saveOdooCredentials(tenantId, creds)
    } catch (err: any) {
      throw new AppError(400, `No se pudo conectar — verifica la URL y credenciales: ${err.message}`)
    }

    const odooVersion = await fetchOdooVersion(input.url)
    await upsertOdooConnectedSource(req.tenantDb, tenantId, input.url, input.database)

    res.json({ connected: true, employeeCount, odooVersion })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/connectors/odoo/preview ────────────────────────
// Dry-run: misma forma que GET /api/connectors/preview/excel — el mapeo
// Odoo -> CÓDICE es FIJO (ver ODOO_FIELD_MAP), no hay columnas que el
// usuario deba decidir.

router.post('/preview', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const creds = await getOdooCredentials(tenantId)
    if (!creds) throw new AppError(400, 'Odoo no está conectado')

    const records = await fetchAllOdooEmployees(creds)
    const mapped = records.map(mapOdooRecordToEmployee)

    const headers = ODOO_FIELD_MAP.map((f, index) => ({
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

// ── POST /api/connectors/odoo/sync ───────────────────────────

router.post('/sync', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const creds = await getOdooCredentials(tenantId)
    if (!creds) throw new AppError(400, 'Odoo no está conectado')

    const jobId = await queueOdooSync(tenantId)
    res.json({ jobId, status: 'queued' })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/connectors/odoo/status ──────────────────────────

router.get('/status', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb

    const creds = await getOdooCredentials(tenantId)
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

// ── DELETE /api/connectors/odoo/disconnect ───────────────────

router.delete('/disconnect', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    await deleteOdooCredentials(tenantId)
    await req.tenantDb.$executeRaw`
      UPDATE connected_sources SET status = 'DISCONNECTED' WHERE tenant_id = ${tenantId} AND type = ${SOURCE}
    `
    res.json({ disconnected: true })
  } catch (err) {
    next(err)
  }
})

// ── Orquestación del sync real (llamada por el worker de odooSyncQueue) ──

export async function runOdooSync(tenantId: string, tenantDb: any, io: any): Promise<OdooSyncResult> {
  const errors: OdooSyncRowError[] = []
  let inserted = 0
  let updated = 0

  const creds = await getOdooCredentials(tenantId)
  if (!creds) {
    await markOdooSourceSynced(tenantDb, tenantId, 'ERROR', 'Odoo no está conectado')
    return { processed: 0, inserted: 0, updated: 0, errors: [{ message: 'Odoo no está conectado' }] }
  }

  try {
    const records = await fetchAllOdooEmployees(creds)

    for (const raw of records) {
      const row = mapOdooRecordToEmployee(raw)
      const odooId = String(raw['id'] ?? '')
      try {
        const { outcome } = await upsertEmployee(tenantDb, tenantId, row, SOURCE)
        if (outcome === 'inserted') inserted++
        else updated++
      } catch (err: any) {
        errors.push({ employeeId: odooId, message: err.message })
      }
    }

    const allFailed = records.length > 0 && errors.length === records.length
    await markOdooSourceSynced(
      tenantDb, tenantId,
      allFailed ? 'ERROR' : 'CONNECTED',
      errors.length > 0 ? `${errors.length} registro(s) con error` : null,
    )
  } catch (err: any) {
    await markOdooSourceSynced(tenantDb, tenantId, 'ERROR', err.message)
    errors.push({ message: err.message })
  }

  const result: OdooSyncResult = { processed: inserted + updated, inserted, updated, errors }

  io?.to(`tenant:${tenantId}`).emit('sync:complete', {
    processed: result.processed, updated: result.updated, errors: result.errors, timestamp: new Date().toISOString(),
  })
  io?.to(`tenant:${tenantId}`).emit('headcount:refresh', {})

  return result
}

export default router

// ============================================================
// CÓDICE · Buk — endpoints
// Conector "vivo" — mismo modelo que routes/runa.ts: connected_sources solo
// guarda METADATA, el dato real siempre viene de la API en cada sync.
// A diferencia de Runa/Worky/Factorial, Buk pide un segundo campo (país) —
// resuelve el dominio (.cl / .com.mx), ver bukConnector.ts.
// ============================================================

import { Router, Request, Response, NextFunction } from 'express'
import * as crypto from 'crypto'
import { z } from 'zod'
import { requireHR } from '../middleware/auth'
import { AppError } from '../lib/errors'
import {
  BukCredentials, BUK_FIELD_MAP,
  getBukCredentials, saveBukCredentials, deleteBukCredentials,
  fetchAllBukEmployees, mapBukRecordToEmployee, testBukConnection,
} from '../connectors/buk/bukConnector'
import { upsertEmployee } from './connectors'
import { queueBukSync } from '../jobs/bukSyncQueue'

const router = Router()

const SOURCE = 'BUK'

interface BukSyncRowError { employeeId?: string; message: string }
interface BukSyncResult   { processed: number; inserted: number; updated: number; errors: BukSyncRowError[] }

// ── connected_sources: solo metadata (sin archivo real que guardar) ──

async function upsertBukConnectedSource(tenantDb: any, tenantId: string, country: string): Promise<void> {
  const fileName = 'Buk (API)'
  const fileContent = JSON.stringify({ country, connectedAt: new Date().toISOString() })
  const checksum = crypto.createHash('md5').update(`${tenantId}:buk:${country}`).digest('hex')

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

async function markBukSourceSynced(tenantDb: any, tenantId: string, status: 'CONNECTED' | 'ERROR', lastError: string | null): Promise<void> {
  await tenantDb.$executeRaw`
    UPDATE connected_sources SET status = ${status}, last_error = ${lastError}, last_read_at = NOW()
    WHERE tenant_id = ${tenantId} AND type = ${SOURCE}
  `
}

// ── POST /api/connectors/buk/connect ─────────────────────────

const connectSchema = z.object({
  apiKey:  z.string().min(1),
  country: z.enum(['cl', 'mx']).default('mx'),
})

router.post('/connect', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = connectSchema.parse(req.body)
    const tenantId = req.tenant.id
    const creds: BukCredentials = { apiKey: input.apiKey, country: input.country }

    let employeeCount: number
    let sample: ReturnType<typeof mapBukRecordToEmployee>[]
    try {
      ({ employeeCount, sample } = await testBukConnection(creds))
    } catch (err: any) {
      throw new AppError(400, `Credenciales inválidas o sin permisos: ${err.message}`)
    }

    await saveBukCredentials(tenantId, creds)
    await upsertBukConnectedSource(req.tenantDb, tenantId, input.country)

    res.json({ connected: true, employeeCount, sample: sample.slice(0, 3) })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/connectors/buk/preview ──────────────────────────

router.get('/preview', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const creds = await getBukCredentials(tenantId)
    if (!creds) throw new AppError(400, 'Buk no está conectado')

    const records = await fetchAllBukEmployees(creds)
    const mapped = records.map(mapBukRecordToEmployee)

    const headers = BUK_FIELD_MAP.map((f, index) => ({
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

// ── POST /api/connectors/buk/sync ────────────────────────────

router.post('/sync', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const creds = await getBukCredentials(tenantId)
    if (!creds) throw new AppError(400, 'Buk no está conectado')

    const jobId = await queueBukSync(tenantId)
    res.json({ jobId, status: 'queued' })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/connectors/buk/status ───────────────────────────

router.get('/status', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb

    const creds = await getBukCredentials(tenantId)
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

// ── DELETE /api/connectors/buk/disconnect ────────────────────

router.delete('/disconnect', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    await deleteBukCredentials(tenantId)
    await req.tenantDb.$executeRaw`
      UPDATE connected_sources SET status = 'DISCONNECTED' WHERE tenant_id = ${tenantId} AND type = ${SOURCE}
    `
    res.json({ disconnected: true })
  } catch (err) {
    next(err)
  }
})

// ── Orquestación del sync real (llamada por el worker de bukSyncQueue) ──

export async function runBukSync(tenantId: string, tenantDb: any, io: any): Promise<BukSyncResult> {
  const errors: BukSyncRowError[] = []
  let inserted = 0
  let updated = 0

  const creds = await getBukCredentials(tenantId)
  if (!creds) {
    await markBukSourceSynced(tenantDb, tenantId, 'ERROR', 'Buk no está conectado')
    return { processed: 0, inserted: 0, updated: 0, errors: [{ message: 'Buk no está conectado' }] }
  }

  try {
    const records = await fetchAllBukEmployees(creds)

    for (const raw of records) {
      const row = mapBukRecordToEmployee(raw)
      const bukId = String(raw['id'] ?? '')
      try {
        const { outcome } = await upsertEmployee(tenantDb, tenantId, row, SOURCE)
        if (outcome === 'inserted') inserted++
        else updated++
      } catch (err: any) {
        errors.push({ employeeId: bukId, message: err.message })
      }
    }

    const allFailed = records.length > 0 && errors.length === records.length
    await markBukSourceSynced(
      tenantDb, tenantId,
      allFailed ? 'ERROR' : 'CONNECTED',
      errors.length > 0 ? `${errors.length} registro(s) con error` : null,
    )
  } catch (err: any) {
    await markBukSourceSynced(tenantDb, tenantId, 'ERROR', err.message)
    errors.push({ message: err.message })
  }

  const result: BukSyncResult = { processed: inserted + updated, inserted, updated, errors }

  io?.to(`tenant:${tenantId}`).emit('sync:complete', {
    processed: result.processed, updated: result.updated, errors: result.errors, timestamp: new Date().toISOString(),
  })
  io?.to(`tenant:${tenantId}`).emit('headcount:refresh', {})

  return result
}

export default router

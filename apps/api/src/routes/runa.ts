// ============================================================
// CÓDICE · Runa HR — endpoints
// Conector "vivo": no hay un file buffer que guardar — connected_sources
// solo registra METADATA de la conexión (para que "Archivo conectado"/
// Historial tengan algo consistente que mostrar), el dato real siempre
// viene de la API de Runa en cada sync.
// ============================================================

import { Router, Request, Response, NextFunction } from 'express'
import * as crypto from 'crypto'
import { z } from 'zod'
import { requireHR } from '../middleware/auth'
import { AppError } from '../lib/errors'
import {
  RunaCredentials, RUNA_FIELD_MAP,
  getRunaCredentials, saveRunaCredentials, deleteRunaCredentials,
  fetchAllRunaEmployees, mapRunaRecordToEmployee, testRunaConnection,
} from '../connectors/runa/runaConnector'
import { upsertEmployee } from './connectors'
import { queueRunaSync } from '../jobs/runaSyncQueue'

const router = Router()

const SOURCE = 'RUNA'

interface RunaSyncRowError { employeeId?: string; message: string }
interface RunaSyncResult   { processed: number; inserted: number; updated: number; errors: RunaSyncRowError[] }

// ── connected_sources: solo metadata (sin archivo real que guardar) ──

async function upsertRunaConnectedSource(tenantDb: any, tenantId: string): Promise<void> {
  const fileName = 'Runa HR (API)'
  const fileContent = JSON.stringify({ connectedAt: new Date().toISOString() })
  const checksum = crypto.createHash('md5').update(`${tenantId}:runa`).digest('hex')

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

async function markRunaSourceSynced(tenantDb: any, tenantId: string, status: 'CONNECTED' | 'ERROR', lastError: string | null): Promise<void> {
  await tenantDb.$executeRaw`
    UPDATE connected_sources SET status = ${status}, last_error = ${lastError}, last_read_at = NOW()
    WHERE tenant_id = ${tenantId} AND type = ${SOURCE}
  `
}

// ── POST /api/connectors/runa/connect ────────────────────────

const connectSchema = z.object({ apiKey: z.string().min(1) })

router.post('/connect', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { apiKey } = connectSchema.parse(req.body)
    const tenantId = req.tenant.id
    const creds: RunaCredentials = { token: apiKey }

    let employeeCount: number
    let sample: ReturnType<typeof mapRunaRecordToEmployee>[]
    try {
      ({ employeeCount, sample } = await testRunaConnection(creds))
    } catch (err: any) {
      throw new AppError(400, `Credenciales inválidas o sin permisos: ${err.message}`)
    }

    await saveRunaCredentials(tenantId, creds)
    await upsertRunaConnectedSource(req.tenantDb, tenantId)

    res.json({ connected: true, employeeCount, sample: sample.slice(0, 3) })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/connectors/runa/preview ─────────────────────────
// Dry-run: trae TODOS los empleados de Runa ya mapeados (misma forma que
// GET /api/connectors/preview/excel) — el wizard de conectores (Mapeo/Vista
// previa/Confirmar) lo consume tal cual vía sourceType="RUNA"/externalData,
// sin cambios en esos steps. El mapeo Runa -> CÓDICE es FIJO — cada header
// ya llega con `field` resuelto.

router.get('/preview', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const creds = await getRunaCredentials(tenantId)
    if (!creds) throw new AppError(400, 'Runa HR no está conectado')

    const records = await fetchAllRunaEmployees(creds)
    const mapped = records.map(mapRunaRecordToEmployee)

    const headers = RUNA_FIELD_MAP.map((f, index) => ({
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

// ── POST /api/connectors/runa/sync ───────────────────────────

router.post('/sync', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const creds = await getRunaCredentials(tenantId)
    if (!creds) throw new AppError(400, 'Runa HR no está conectado')

    const jobId = await queueRunaSync(tenantId)
    res.json({ jobId, status: 'queued' })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/connectors/runa/status ──────────────────────────

router.get('/status', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb

    const creds = await getRunaCredentials(tenantId)
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

// ── DELETE /api/connectors/runa/disconnect ───────────────────

router.delete('/disconnect', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    await deleteRunaCredentials(tenantId)
    await req.tenantDb.$executeRaw`
      UPDATE connected_sources SET status = 'DISCONNECTED' WHERE tenant_id = ${tenantId} AND type = ${SOURCE}
    `
    res.json({ disconnected: true })
  } catch (err) {
    next(err)
  }
})

// ── Orquestación del sync real (llamada por el worker de runaSyncQueue) ──
// No vive en runaConnector.ts (que se mantiene "puro": fetch + mapeo, sin
// tocar DB) — mismo criterio que runZohoSync vive en routes/zoho.ts.

export async function runRunaSync(tenantId: string, tenantDb: any, io: any): Promise<RunaSyncResult> {
  const errors: RunaSyncRowError[] = []
  let inserted = 0
  let updated = 0

  const creds = await getRunaCredentials(tenantId)
  if (!creds) {
    await markRunaSourceSynced(tenantDb, tenantId, 'ERROR', 'Runa HR no está conectado')
    return { processed: 0, inserted: 0, updated: 0, errors: [{ message: 'Runa HR no está conectado' }] }
  }

  try {
    const records = await fetchAllRunaEmployees(creds)

    for (const raw of records) {
      const row = mapRunaRecordToEmployee(raw)
      const runaId = String(raw['id'] ?? '')
      try {
        const { outcome } = await upsertEmployee(tenantDb, tenantId, row, SOURCE)
        if (outcome === 'inserted') inserted++
        else updated++
      } catch (err: any) {
        errors.push({ employeeId: runaId, message: err.message })
      }
    }

    const allFailed = records.length > 0 && errors.length === records.length
    await markRunaSourceSynced(
      tenantDb, tenantId,
      allFailed ? 'ERROR' : 'CONNECTED',
      errors.length > 0 ? `${errors.length} registro(s) con error` : null,
    )
  } catch (err: any) {
    await markRunaSourceSynced(tenantDb, tenantId, 'ERROR', err.message)
    errors.push({ message: err.message })
  }

  const result: RunaSyncResult = { processed: inserted + updated, inserted, updated, errors }

  io?.to(`tenant:${tenantId}`).emit('sync:complete', {
    processed: result.processed, updated: result.updated, errors: result.errors, timestamp: new Date().toISOString(),
  })
  io?.to(`tenant:${tenantId}`).emit('headcount:refresh', {})

  return result
}

export default router

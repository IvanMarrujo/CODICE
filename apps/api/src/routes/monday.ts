// ============================================================
// CÓDICE · Monday.com — endpoints
// Conector "vivo" (API en cada sync) — mismo modelo que Zoho
// (routes/zoho.ts): connected_sources solo guarda METADATA, nunca un
// archivo real; el dato vivo siempre viene de la API en cada sync.
// ============================================================

import { Router, Request, Response, NextFunction } from 'express'
import * as crypto from 'crypto'
import { z } from 'zod'
import { requireHR } from '../middleware/auth'
import { AppError } from '../lib/errors'
import {
  MondayCredentials,
  getMondayCredentials, saveMondayCredentials, deleteMondayCredentials,
  getMondayBoards, fetchMondayBoardData, buildMondayHeaders, mapMondayItemToEmployee,
} from '../connectors/monday/mondayConnector'
import { upsertEmployee } from './connectors'
import { queueMondaySync } from '../jobs/mondaySyncQueue'

const router = Router()

const SOURCE = 'MONDAY'

interface MondaySyncRowError { employeeId?: string; message: string }
interface MondaySyncResult   { processed: number; inserted: number; updated: number; errors: MondaySyncRowError[] }

// ── connected_sources: solo metadata (sin archivo real que guardar) ──

async function upsertMondayConnectedSource(tenantDb: any, tenantId: string, boardId: string): Promise<void> {
  const fileName = 'Monday.com (API)'
  const fileContent = JSON.stringify({ boardId, connectedAt: new Date().toISOString() })
  const checksum = crypto.createHash('md5').update(`${tenantId}:monday:${boardId}`).digest('hex')

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

async function markMondaySourceSynced(tenantDb: any, tenantId: string, status: 'CONNECTED' | 'ERROR', lastError: string | null): Promise<void> {
  await tenantDb.$executeRaw`
    UPDATE connected_sources SET status = ${status}, last_error = ${lastError}, last_read_at = NOW()
    WHERE tenant_id = ${tenantId} AND type = ${SOURCE}
  `
}

// ── POST /api/connectors/monday/boards ───────────────────────
// Paso 1 del modal de conexión: valida el token y lista los boards
// accesibles para el selector — todavía no guarda nada.

const tokenSchema = z.object({ apiToken: z.string().min(1) })

router.post('/boards', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { apiToken } = tokenSchema.parse(req.body)
    let boards
    try {
      boards = await getMondayBoards(apiToken)
    } catch (err: any) {
      throw new AppError(400, `Token inválido: ${err.message}`)
    }
    res.json({ boards })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/connectors/monday/connect ──────────────────────
// Paso 2: token + board elegido — guarda credenciales y confirma la conexión.

const connectSchema = z.object({
  apiToken: z.string().min(1),
  boardId:  z.string().min(1),
})

router.post('/connect', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = connectSchema.parse(req.body)
    const tenantId = req.tenant.id
    const creds: MondayCredentials = { ...input }

    let itemCount: number
    let sample: ReturnType<typeof mapMondayItemToEmployee>[]
    try {
      const { columns, items } = await fetchMondayBoardData(creds)
      const headers = buildMondayHeaders(columns)
      itemCount = items.length
      sample = items.slice(0, 3).map((item) => mapMondayItemToEmployee(item, headers))
    } catch (err: any) {
      throw new AppError(400, `No se pudo leer el board: ${err.message}`)
    }

    await saveMondayCredentials(tenantId, creds)
    await upsertMondayConnectedSource(req.tenantDb, tenantId, input.boardId)

    res.json({ connected: true, itemCount, sample })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/connectors/monday/preview ───────────────────────
// Dry-run: misma forma que GET /api/connectors/preview/excel — a diferencia
// de Zoho (mapeo fijo), las columnas de Monday varían por board, así que
// esto sí puede traer columnas "Sin mapear" (el usuario puede usar
// "Crear campo personalizado" desde el mismo Step 2, como en Excel).

router.get('/preview', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const creds = await getMondayCredentials(tenantId)
    if (!creds) throw new AppError(400, 'Monday.com no está conectado')

    const { columns, items } = await fetchMondayBoardData(creds)
    const mondayHeaders = buildMondayHeaders(columns)
    const mapped = items.map((item) => mapMondayItemToEmployee(item, mondayHeaders))

    const headers = mondayHeaders.map((h, index) => ({
      index, label: h.label, field: h.field === 'full_name' ? 'full_name' : h.field,
      fieldLabel: h.field ? h.label : null, customLabel: null,
      suggestion: null,
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

// ── POST /api/connectors/monday/sync ─────────────────────────

router.post('/sync', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const creds = await getMondayCredentials(tenantId)
    if (!creds) throw new AppError(400, 'Monday.com no está conectado')

    const jobId = await queueMondaySync(tenantId)
    res.json({ jobId, status: 'queued' })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/connectors/monday/status ────────────────────────

router.get('/status', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb

    const creds = await getMondayCredentials(tenantId)
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

// ── DELETE /api/connectors/monday/disconnect ─────────────────

router.delete('/disconnect', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    await deleteMondayCredentials(tenantId)
    await req.tenantDb.$executeRaw`
      UPDATE connected_sources SET status = 'DISCONNECTED' WHERE tenant_id = ${tenantId} AND type = ${SOURCE}
    `
    res.json({ disconnected: true })
  } catch (err) {
    next(err)
  }
})

// ── Orquestación del sync real (llamada por el worker de mondaySyncQueue) ──

export async function runMondaySync(tenantId: string, tenantDb: any, io: any): Promise<MondaySyncResult> {
  const errors: MondaySyncRowError[] = []
  let inserted = 0
  let updated = 0

  const creds = await getMondayCredentials(tenantId)
  if (!creds) {
    await markMondaySourceSynced(tenantDb, tenantId, 'ERROR', 'Monday.com no está conectado')
    return { processed: 0, inserted: 0, updated: 0, errors: [{ message: 'Monday.com no está conectado' }] }
  }

  try {
    const { columns, items } = await fetchMondayBoardData(creds)
    const headers = buildMondayHeaders(columns)

    for (const item of items) {
      const row = mapMondayItemToEmployee(item, headers)
      try {
        const { outcome } = await upsertEmployee(tenantDb, tenantId, row, SOURCE)
        if (outcome === 'inserted') inserted++
        else updated++
      } catch (err: any) {
        errors.push({ employeeId: item.id, message: err.message })
      }
    }

    const allFailed = items.length > 0 && errors.length === items.length
    await markMondaySourceSynced(
      tenantDb, tenantId,
      allFailed ? 'ERROR' : 'CONNECTED',
      errors.length > 0 ? `${errors.length} registro(s) con error` : null,
    )
  } catch (err: any) {
    await markMondaySourceSynced(tenantDb, tenantId, 'ERROR', err.message)
    errors.push({ message: err.message })
  }

  const result: MondaySyncResult = { processed: inserted + updated, inserted, updated, errors }

  io?.to(`tenant:${tenantId}`).emit('sync:complete', {
    processed: result.processed, updated: result.updated, errors: result.errors, timestamp: new Date().toISOString(),
  })
  io?.to(`tenant:${tenantId}`).emit('headcount:refresh', {})

  return result
}

export default router

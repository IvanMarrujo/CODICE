// ============================================================
// CÓDICE · Webhook routes — Agente local (Nomipaq / Excel / DBF)
// Autenticación propia (HMAC) — el agente corre en la máquina del
// cliente y no tiene sesión de usuario, así que este router se monta
// ANTES de authMiddleware/tenantMiddleware (ver index.ts) y resuelve
// el tenant a mano.
//
// Reutiliza exactamente lo que ya existe para conectores en vivo:
// upsertConnectedSource() (routes/connectors.ts) para guardar el
// archivo, y la cola 'auto-sync' (jobs/autoSyncQueue.ts) para el ETL
// en background — no se crea cola ni worker nuevos.
// ============================================================

import { Router, Request, Response, NextFunction } from 'express'
import multer                    from 'multer'
import * as path                 from 'path'
import * as crypto                from 'crypto'
import { z }                     from 'zod'
import { AppError }              from '../lib/errors'
import { redis }                 from '../lib/redis'
import { prismaPublic }          from '../lib/prisma'
import { getTenantPrisma }       from '../middleware/tenant'
import { upsertConnectedSource } from './connectors'
import { autoSyncQueue }         from '../jobs/autoSyncQueue'

const router = Router()

export const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'codice_webhook_secret_dev'
export const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000 // 5 min

const EXT_BY_SOURCE_TYPE: Record<string, Set<string>> = {
  EXCEL: new Set(['.xlsx', '.csv']),
  CFDI:  new Set(['.xml']),
  DBF:   new Set(['.dbf']),
}

// ── Auth HMAC ─────────────────────────────────────────────────
// Firma: sha256(`${tenantId}:${timestamp}`) con WEBHOOK_SECRET.
// timingSafeEqual en vez de !== — mismo contrato (true/false), solo evita
// filtrar el secreto por timing en un endpoint nuevo sin comportamiento
// previo que romper.

function verifyHmac(tenantId: string, req: Request): 'ok' | 'expired' | 'invalid' {
  const signature = req.headers['x-codice-secret'] as string | undefined
  const timestampHeader = req.headers['x-timestamp'] as string | undefined
  if (!signature || !timestampHeader) return 'invalid'

  const timestamp = parseInt(timestampHeader, 10)
  if (!Number.isFinite(timestamp)) return 'invalid'
  if (Math.abs(Date.now() - timestamp) > TIMESTAMP_TOLERANCE_MS) return 'expired'

  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(`${tenantId}:${timestampHeader}`).digest('hex')
  const sigBuf = Buffer.from(signature)
  const expBuf = Buffer.from(expected)
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return 'invalid'
  return 'ok'
}

function requireHmac(tenantId: string, req: Request, res: Response): boolean {
  const result = verifyHmac(tenantId, req)
  if (result === 'expired') { res.status(401).json({ error: 'Timestamp expired' }); return false }
  if (result === 'invalid') { res.status(401).json({ error: 'Invalid signature' }); return false }
  return true
}

// ── Resolución de tenant — Redis primero, Postgres como fuente de verdad ─
// provisionTenant.ts guarda `t:{id}:status` = 'provisioning' UNA sola vez y
// nunca lo actualiza a 'active' — así que un cache-miss o un valor viejo no
// implica que el tenant esté inactivo: Postgres manda, y si está ACTIVE
// refrescamos el cache para que la siguiente llamada sí pegue en Redis.

async function resolveActiveTenant(tenantId: string): Promise<{ dbSchema: string; plan: string } | null> {
  const cacheKey = `t:${tenantId}:status`
  const cachedStatus = await redis.get(cacheKey)

  const tenant = await prismaPublic.tenant.findUnique({
    where:  { id: tenantId },
    select: { dbSchema: true, plan: true, status: true },
  })
  if (!tenant || tenant.status !== 'ACTIVE') return null

  if (cachedStatus !== 'ACTIVE') await redis.set(cacheKey, 'ACTIVE', 'EX', 300)
  return { dbSchema: tenant.dbSchema, plan: tenant.plan }
}

// ── Upload middleware ─────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 20 * 1024 * 1024, files: 2 },
}).array('files', 2)

function handleUpload(req: Request, res: Response, next: NextFunction) {
  upload(req, res, (err: any) => {
    if (!err) return next()
    if (err instanceof multer.MulterError) return next(new AppError(400, err.message))
    next(err)
  })
}

// ── POST /api/webhook/sync/:tenantId/:sourceType ─────────────
// El agente detecta un cambio en el archivo vigilado y lo sube aquí.
// Responde 202 de inmediato — el ETL real corre en background (cola
// 'auto-sync', job 'webhook-sync').

const sourceTypeSchema = z.enum(['EXCEL', 'DBF', 'CFDI'])

router.post('/sync/:tenantId/:sourceType', handleUpload, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = req.params
    const sourceTypeResult = sourceTypeSchema.safeParse(req.params.sourceType)
    if (!sourceTypeResult.success) throw new AppError(400, 'sourceType debe ser EXCEL, DBF o CFDI')
    const sourceType = sourceTypeResult.data

    if (!requireHmac(tenantId, req, res)) return

    const tenant = await resolveActiveTenant(tenantId)
    if (!tenant) throw new AppError(404, 'Tenant no encontrado o inactivo')

    // Noisy neighbor: como máximo ~10 syncs/hora por tenant vía webhook.
    const rateKey = `t:${tenantId}:webhook:rate`
    const recentSyncs = await redis.get(rateKey)
    if (recentSyncs && parseInt(recentSyncs, 10) > 10) {
      return res.status(429).json({ error: 'Demasiadas sincronizaciones. Intenta en unos minutos.' })
    }
    await redis.incr(rateKey)
    await redis.expire(rateKey, 3600)

    const files = (req.files as Express.Multer.File[]) || []
    if (files.length === 0) throw new AppError(400, 'No se recibió ningún archivo')

    const allowedExt = EXT_BY_SOURCE_TYPE[sourceType]
    for (const f of files) {
      const ext = path.extname(f.originalname).toLowerCase()
      if (!allowedExt.has(ext)) throw new AppError(400, `"${f.originalname}" no corresponde al tipo ${sourceType}`)
    }

    const tenantDb = await getTenantPrisma(tenant.dbSchema)
    await tenantDb.$executeRawUnsafe(`SET search_path = "${tenant.dbSchema}", public`)

    await upsertConnectedSource(tenantDb, tenantId, sourceType, files)
    const sourceRows = await tenantDb.$queryRaw<{ id: string }[]>`
      SELECT id FROM connected_sources WHERE tenant_id = ${tenantId} AND type = ${sourceType} LIMIT 1
    `
    const sourceId = sourceRows[0]?.id
    if (!sourceId) throw new AppError(500, 'No se pudo registrar la fuente conectada')

    await autoSyncQueue.add(
      'webhook-sync',
      {
        tenantId,
        sourceType,
        sourceId,
        triggeredBy:  'agent',
        agentVersion: req.headers['x-agent-version'] as string | undefined,
        priority:     tenant.plan === 'ENTERPRISE' ? 10 : tenant.plan === 'CORE' ? 5 : 1,
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 2000 } }
    )

    await redis.set(
      `t:${tenantId}:agent:heartbeat`,
      JSON.stringify({ ts: Date.now(), sourceType, version: req.headers['x-agent-version'] }),
      'EX', 90
    )

    res.status(202).json({ ok: true, sourceId })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/webhook/heartbeat/:tenantId ────────────────────

const heartbeatSchema = z.object({
  agentVersion: z.string().optional(),
  watchedPaths: z.array(z.string()).optional(),
  os:           z.string().optional(),
  lastChecksum: z.string().optional(),
})

router.post('/heartbeat/:tenantId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = req.params
    if (!requireHmac(tenantId, req, res)) return

    const body = heartbeatSchema.parse(req.body)
    await redis.set(
      `t:${tenantId}:agent:heartbeat`,
      JSON.stringify({ ts: Date.now(), ...body }),
      'EX', 90
    )
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router

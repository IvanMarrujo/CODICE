// ============================================================
// CÓDICE · Dispositivos ZKTeco (checadoras ADMS)
// GET    /api/devices/zkteco      (requireHR) — lista del tenant
// POST   /api/devices/zkteco      (requireHR) — registra dispositivo
// DELETE /api/devices/zkteco/:sn  (requireHR) — da de baja
//
// Cada registro escribe en DOS lugares: la tabla del tenant (metadata rica
// para el admin shell) y la tabla global `public.zkteco_devices` (fuente de
// verdad para la resolución SN → tenant que hace el webhook, ver
// routes/zktecoWebhook.ts) + Redis como cache de esa resolución.
// ============================================================

import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { requireHR } from '../middleware/auth'
import { AppError } from '../lib/errors'
import { redis } from '../lib/redis'
import { prismaPublic } from '../lib/prisma'
import { insertAuditLog } from './employees'

const router = Router()

function snKey(sn: string) { return `codice:zkteco:sn:${sn}` }
const SN_CACHE_TTL = 60 * 60 * 24 * 30 // 30 días

// ── GET /api/devices/zkteco ────────────────────────────────────

router.get('/zkteco', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await req.tenantDb.$queryRaw<any[]>`
      SELECT * FROM zkteco_devices WHERE tenant_id = ${req.tenant.id} ORDER BY created_at DESC
    `
    res.json({ devices: rows })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/devices/zkteco ───────────────────────────────────

const registerSchema = z.object({
  sn:        z.string().min(1),
  alias:     z.string().optional(),
  location:  z.string().optional(),
  ipAddress: z.string().optional(),
  model:     z.string().optional(),
})

router.post('/zkteco', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = registerSchema.parse(req.body)
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb

    // El SN es único a nivel GLOBAL (public.zkteco_devices) — si otro
    // tenant ya lo registró, no se permite un segundo dueño.
    const existingGlobal = await prismaPublic.$queryRawUnsafe<{ tenant_id: string }[]>(
      `SELECT tenant_id FROM public.zkteco_devices WHERE sn = $1 LIMIT 1`, input.sn
    ).catch(() => [] as { tenant_id: string }[])
    if (existingGlobal[0] && existingGlobal[0].tenant_id !== tenantId) {
      throw new AppError(409, 'Este número de serie ya está registrado en otra cuenta')
    }

    const rows = await tenantDb.$queryRaw<any[]>`
      INSERT INTO zkteco_devices (tenant_id, sn, alias, location, ip_address, model)
      VALUES (${tenantId}, ${input.sn}, ${input.alias ?? null}, ${input.location ?? null}, ${input.ipAddress ?? null}, ${input.model || 'UA760'})
      ON CONFLICT (sn) DO UPDATE SET
        alias = EXCLUDED.alias, location = EXCLUDED.location, ip_address = EXCLUDED.ip_address, model = EXCLUDED.model, status = 'ACTIVE'
      RETURNING *
    `
    const device = rows[0]

    await prismaPublic.$executeRawUnsafe(
      `INSERT INTO public.zkteco_devices (sn, tenant_id, alias) VALUES ($1, $2, $3)
       ON CONFLICT (sn) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, alias = EXCLUDED.alias`,
      input.sn, tenantId, input.alias ?? null
    )
    await redis.set(snKey(input.sn), tenantId, 'EX', SN_CACHE_TTL)

    await insertAuditLog(tenantDb, tenantId, req, 'device.zkteco_registered', `device:${input.sn}`, { device })

    res.status(201).json(device)
  } catch (err) {
    next(err)
  }
})

// ── DELETE /api/devices/zkteco/:sn ─────────────────────────────

router.delete('/zkteco/:sn', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb
    const sn = req.params.sn

    const rows = await tenantDb.$queryRaw<any[]>`
      DELETE FROM zkteco_devices WHERE tenant_id = ${tenantId} AND sn = ${sn} RETURNING *
    `
    if (!rows[0]) throw new AppError(404, 'Dispositivo no encontrado')

    await prismaPublic.$executeRawUnsafe(
      `DELETE FROM public.zkteco_devices WHERE sn = $1 AND tenant_id = $2`, sn, tenantId
    )
    await redis.del(snKey(sn))

    await insertAuditLog(tenantDb, tenantId, req, 'device.zkteco_removed', `device:${sn}`, { sn })

    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router

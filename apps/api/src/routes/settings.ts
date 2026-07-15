// ============================================================
// CÓDICE · Settings routes
// Configuración de WhatsApp por tenant (credenciales + toggles de
// notificación) — guardada en Redis, no en Postgres: es config
// operativa liviana, no un registro que necesite historial/auditoría.
// ============================================================

import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { requireHR } from '../middleware/auth'
import { AppError } from '../lib/errors'
import {
  getWhatsAppConfig, setWhatsAppConfig, isConnected,
  getNotificationSettings, setNotificationSettings, getMockLog,
} from '../lib/whatsapp'
import { LFT_MINIMOS } from './lft'

const router = Router()

function maskInstanceId(id: string): string {
  if (id.length <= 4) return '••••'
  return `••••${id.slice(-4)}`
}

// ── GET /api/settings/whatsapp ──────────────────────────────────

router.get('/whatsapp', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const [config, connected, settings] = await Promise.all([
      getWhatsAppConfig(tenantId),
      isConnected(tenantId),
      getNotificationSettings(tenantId),
    ])
    res.json({
      connected,
      instanceIdMasked: config ? maskInstanceId(config.instanceId) : null,
      settings,
    })
  } catch (err) {
    next(err)
  }
})

// ── PATCH /api/settings/whatsapp ────────────────────────────────

const patchSchema = z.object({
  instanceId: z.string().min(1).optional(),
  token:      z.string().min(1).optional(),
  settings: z.object({
    solicitudes:  z.boolean().optional(),
    nomina:       z.boolean().optional(),
    salud:        z.boolean().optional(),
    capacitacion: z.boolean().optional(),
  }).optional(),
})

router.patch('/whatsapp', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = patchSchema.parse(req.body)
    const tenantId = req.tenant.id

    if (input.instanceId && input.token) {
      await setWhatsAppConfig(tenantId, { instanceId: input.instanceId, token: input.token })
    }
    if (input.settings) {
      await setNotificationSettings(tenantId, input.settings)
    }

    const [config, connected, settings] = await Promise.all([
      getWhatsAppConfig(tenantId),
      isConnected(tenantId),
      getNotificationSettings(tenantId),
    ])
    res.json({
      connected,
      instanceIdMasked: config ? maskInstanceId(config.instanceId) : null,
      settings,
    })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/settings/whatsapp/mock-log ─────────────────────────

router.get('/whatsapp/mock-log', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await getMockLog(req.tenant.id)
    res.json({ data })
  } catch (err) {
    next(err)
  }
})

// ── Política de vacaciones ───────────────────────────────────────

const DEFAULT_POLICY = {
  year_1_days: LFT_MINIMOS.year_1_days,
  year_2_days: LFT_MINIMOS.year_2_days,
  year_3_days: LFT_MINIMOS.year_3_days,
  year_4_days: LFT_MINIMOS.year_4_days,
  year_5_days: LFT_MINIMOS.year_5_days,
  additional_days_per_5_years: 2,
  accrual_type: 'ANNUAL',
  carry_over_days: 0,
  max_days: 30,
  notes: null as string | null,
}

function isCompliant(policy: typeof DEFAULT_POLICY): boolean {
  return (Object.keys(LFT_MINIMOS) as (keyof typeof LFT_MINIMOS)[])
    .every((k) => policy[k] >= LFT_MINIMOS[k])
}

router.get('/vacation-policy', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await req.tenantDb.$queryRaw<any[]>`
      SELECT * FROM vacation_policy WHERE tenant_id = ${req.tenant.id} LIMIT 1
    `
    const policy = rows[0] || { ...DEFAULT_POLICY }
    res.json({ ...policy, compliant: isCompliant(policy) })
  } catch (err) {
    next(err)
  }
})

const vacationPolicyPatchSchema = z.object({
  year_1_days:                 z.number().int().min(0).optional(),
  year_2_days:                 z.number().int().min(0).optional(),
  year_3_days:                 z.number().int().min(0).optional(),
  year_4_days:                 z.number().int().min(0).optional(),
  year_5_days:                 z.number().int().min(0).optional(),
  additional_days_per_5_years: z.number().int().min(0).optional(),
  accrual_type:                z.enum(['ANNUAL', 'MONTHLY', 'BIWEEKLY']).optional(),
  carry_over_days:             z.number().int().min(0).optional(),
  max_days:                    z.number().int().min(1).optional(),
  notes:                       z.string().nullable().optional(),
})

router.patch('/vacation-policy', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = vacationPolicyPatchSchema.parse(req.body)

    for (const k of Object.keys(LFT_MINIMOS) as (keyof typeof LFT_MINIMOS)[]) {
      const value = input[k]
      if (value !== undefined && value < LFT_MINIMOS[k]) {
        throw new AppError(400, `${k.replace('_days', '').replace('_', ' ')}: mínimo legal es ${LFT_MINIMOS[k]} días (LFT 2026, no se puede guardar menos)`)
      }
    }

    const entries = Object.entries(input).filter(([, v]) => v !== undefined)
    if (entries.length === 0) throw new AppError(400, 'No se enviaron campos para actualizar')

    const tenantId = req.tenant.id
    await req.tenantDb.$executeRaw`
      INSERT INTO vacation_policy (tenant_id) VALUES (${tenantId})
      ON CONFLICT (tenant_id) DO NOTHING
    `
    const setFragments = entries.map(([k, v]) => Prisma.sql`${Prisma.raw(k)} = ${v}`)
    const rows = await req.tenantDb.$queryRaw<any[]>`
      UPDATE vacation_policy SET ${Prisma.join(setFragments, ', ')}
      WHERE tenant_id = ${tenantId}
      RETURNING *
    `
    const policy = rows[0]
    res.json({ ...policy, compliant: isCompliant(policy) })
  } catch (err) {
    next(err)
  }
})

export default router

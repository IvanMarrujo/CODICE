// ============================================================
// CÓDICE · Settings routes
// Configuración de WhatsApp por tenant (credenciales + toggles de
// notificación) — guardada en Redis, no en Postgres: es config
// operativa liviana, no un registro que necesite historial/auditoría.
// ============================================================

import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { requireHR } from '../middleware/auth'
import {
  getWhatsAppConfig, setWhatsAppConfig, isConnected,
  getNotificationSettings, setNotificationSettings, getMockLog,
} from '../lib/whatsapp'

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

export default router

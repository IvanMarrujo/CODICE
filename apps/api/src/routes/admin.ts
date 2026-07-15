// ============================================================
// CÓDICE · Admin routes
// Perfil del admin autenticado (para el número de WhatsApp, etc).
// ============================================================

import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { requireHR } from '../middleware/auth'
import { prismaPublic } from '../lib/prisma'
import { AppError } from '../lib/errors'

const router = Router()

router.get('/', (req, res) => res.json({ route: 'admin', status: 'ok' }))

// ── GET /api/admin/profile ──────────────────────────────────────

router.get('/profile', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const admin = await prismaPublic.adminUser.findUnique({
      where:  { id: req.jwt.sub },
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, role: true },
    })
    if (!admin) throw new AppError(404, 'Usuario no encontrado')
    res.json(admin)
  } catch (err) {
    next(err)
  }
})

// ── PATCH /api/admin/profile ────────────────────────────────────

const profilePatchSchema = z.object({
  phone:     z.string().nullable().optional(),
  firstName: z.string().min(1).optional(),
  lastName:  z.string().min(1).optional(),
})

router.patch('/profile', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = profilePatchSchema.parse(req.body)
    const entries = Object.entries(input).filter(([, v]) => v !== undefined)
    if (entries.length === 0) throw new AppError(400, 'No se enviaron campos para actualizar')

    const admin = await prismaPublic.adminUser.update({
      where: { id: req.jwt.sub },
      data:  Object.fromEntries(entries),
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, role: true },
    })
    res.json(admin)
  } catch (err) {
    next(err)
  }
})

export default router

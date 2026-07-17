// ============================================================
// CÓDICE · Mentions routes — reconocimientos ("Colaborador del mes",
// "Safety Day", etc.). Otorgar uno suma XP (RECOGNITION_RECEIVED) y
// puede desbloquear el logro "destacado" (ver lib/gamification.ts).
// ============================================================

import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { requireHR, requireEmployee } from '../middleware/auth'
import { AppError } from '../lib/errors'
import { awardXP, XP_RULES } from '../lib/gamification'

const router = Router()

const createSchema = z.object({
  employeeId:     z.string().min(1),
  type:           z.string().min(1),
  description:    z.string().optional(),
  awardedBy:      z.string().optional(),
  awardedDate:    z.string().optional(), // ISO date, default hoy
  showInSignage:  z.boolean().optional(),
  imageUrl:       z.string().optional(),
})

const listQuerySchema = z.object({
  employeeId: z.string().optional(),
})

function emitMentionCreated(req: Request, tenantId: string, mention: unknown) {
  const io = req.app.get('io')
  io?.to(`tenant:${tenantId}`).emit('mention:created', mention)
}

// ── GET /api/mentions ─────────────────────────────────────────
// Un colaborador (rol EMPLOYEE) solo ve los suyos; RH puede filtrar por employeeId.

router.get('/', requireEmployee, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { employeeId } = listQuerySchema.parse(req.query)
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb
    const scopedEmployeeId = req.jwt.role === 'EMPLOYEE' ? req.jwt.sub : (employeeId ?? null)

    const data = await tenantDb.$queryRaw<any[]>`
      SELECT * FROM mentions
      WHERE tenant_id = ${tenantId}
        AND (${scopedEmployeeId}::text IS NULL OR employee_id = ${scopedEmployeeId})
      ORDER BY awarded_date DESC, created_at DESC
      LIMIT 100
    `
    res.json({ data })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/mentions ────────────────────────────────────────
// RH otorga el reconocimiento a nombre de la empresa/depto.

router.post('/', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createSchema.parse(req.body)
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb

    const empRows = await tenantDb.$queryRaw<any[]>`
      SELECT id, full_name FROM employees WHERE id = ${input.employeeId} AND tenant_id = ${tenantId} LIMIT 1
    `
    const employee = empRows[0]
    if (!employee) throw new AppError(404, 'Empleado no encontrado')

    const xpBonus = XP_RULES.RECOGNITION_RECEIVED
    const awardedDate = input.awardedDate ?? new Date().toISOString().slice(0, 10)

    const rows = await tenantDb.$queryRaw<any[]>`
      INSERT INTO mentions (tenant_id, employee_id, type, description, awarded_by, awarded_date, xp_bonus, show_in_signage, image_url)
      VALUES (
        ${tenantId}, ${input.employeeId}, ${input.type}, ${input.description ?? null}, ${input.awardedBy ?? null},
        ${awardedDate}::date, ${xpBonus}, ${input.showInSignage ?? true}, ${input.imageUrl ?? null}
      )
      RETURNING *
    `
    const mention = rows[0]

    await tenantDb.$executeRaw`
      INSERT INTO notifications (tenant_id, employee_id, type, title, body)
      VALUES (${tenantId}, ${input.employeeId}, 'MENTION_RECEIVED', '¡Recibiste un reconocimiento!', ${input.type})
    `
    await awardXP(tenantDb, tenantId, input.employeeId, 'RECOGNITION_RECEIVED', `Reconocimiento: ${input.type}`)

    emitMentionCreated(req, tenantId, mention)

    res.status(201).json(mention)
  } catch (err) {
    next(err)
  }
})

export default router

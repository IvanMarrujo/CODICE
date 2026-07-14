// ============================================================
// CÓDICE · Notifications routes
// GET / — notificaciones de un empleado + conteo de no leídas.
// ============================================================

import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { requireEmployee } from '../middleware/auth'

const router = Router()

const listQuerySchema = z.object({
  employeeId: z.string().min(1).optional(),
})

router.get('/', requireEmployee, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { employeeId } = listQuerySchema.parse(req.query)
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb
    const scopedEmployeeId = (req.jwt.role === 'EMPLOYEE' ? req.jwt.sub : employeeId) ?? null

    const [data, unreadRows] = await Promise.all([
      tenantDb.$queryRaw<any[]>`
        SELECT * FROM notifications
        WHERE tenant_id = ${tenantId}
          AND (${scopedEmployeeId}::text IS NULL OR employee_id = ${scopedEmployeeId})
        ORDER BY created_at DESC
        LIMIT 50
      `,
      tenantDb.$queryRaw<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM notifications
        WHERE tenant_id = ${tenantId}
          AND (${scopedEmployeeId}::text IS NULL OR employee_id = ${scopedEmployeeId})
          AND read = false
      `,
    ])

    res.json({ data, unreadCount: unreadRows[0]?.count ?? 0 })
  } catch (err) {
    next(err)
  }
})

export default router

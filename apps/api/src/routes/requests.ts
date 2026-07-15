// ============================================================
// CÓDICE · Requests routes
// Solicitudes de colaboradores con flujo de 2 etapas:
//   MANAGER (jefe directo) -> WORKFORCE (RH) -> APPROVED
// Cualquier etapa puede terminar en REJECTED.
// ============================================================

import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { requireManager, requireEmployee } from '../middleware/auth'
import { AppError } from '../lib/errors'
import { notifyHR } from '../lib/whatsapp'

const router = Router()

const createSchema = z.object({
  employeeId:  z.string().min(1).optional(), // opcional si el propio empleado crea la solicitud
  type:        z.string().min(1),
  detail:      z.string().optional(),
  notes:       z.string().optional(),
  managerId:   z.string().optional(),
  managerName: z.string().optional(),
})

const listQuerySchema = z.object({
  stage:      z.string().optional(),
  type:       z.string().optional(),
  employeeId: z.string().optional(),
  page:       z.coerce.number().int().min(1).default(1),
  pageSize:   z.coerce.number().int().min(1).max(100).default(20),
})

const decisionSchema = z.object({
  notes: z.string().optional(),
})

// ── Helpers ───────────────────────────────────────────────────

function emitRequestUpdated(req: Request, tenantId: string, request: unknown) {
  const io = req.app.get('io')
  io?.to(`tenant:${tenantId}`).emit('request:updated', request)
}

async function insertNotification(
  tenantDb: any,
  tenantId: string,
  employeeId: string | null,
  type: string,
  title: string,
  body: string,
  link?: string
) {
  await tenantDb.$executeRaw`
    INSERT INTO notifications (tenant_id, employee_id, type, title, body, link)
    VALUES (${tenantId}, ${employeeId}, ${type}, ${title}, ${body}, ${link ?? null})
  `
}

async function findRequestOr404(tenantDb: any, tenantId: string, id: string) {
  const rows = await tenantDb.$queryRaw<any[]>`
    SELECT * FROM requests WHERE id = ${id} AND tenant_id = ${tenantId} LIMIT 1
  `
  if (!rows[0]) throw new AppError(404, 'Solicitud no encontrada')
  return rows[0]
}

const REQUEST_TYPE_LABEL: Record<string, string> = {
  'Vacaciones':               'tu solicitud de vacaciones',
  'Permiso':                  'tu permiso',
  'Constancia laboral':       'tu constancia laboral',
  'Cambio de turno':          'tu cambio de turno',
  'Anticipo de nómina':       'tu anticipo de nómina',
  'Actualización de datos':   'tu actualización de datos',
}

function requestLabel(type: string) {
  return REQUEST_TYPE_LABEL[type] || `tu solicitud (${type})`
}

function folioFor(requestId: string): string {
  return requestId.slice(0, 8).toUpperCase()
}

async function employeeFullName(tenantDb: any, tenantId: string, employeeId: string): Promise<string> {
  const rows = await tenantDb.$queryRaw<{ full_name: string }[]>`
    SELECT full_name FROM employees WHERE id = ${employeeId} AND tenant_id = ${tenantId} LIMIT 1
  `
  return rows[0]?.full_name || 'Colaborador'
}

// ── POST /api/requests ────────────────────────────────────────
// El colaborador crea su propia solicitud (employeeId = su id si role EMPLOYEE),
// o RH/jefe la da de alta a nombre de un colaborador.

router.post('/', requireEmployee, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createSchema.parse(req.body)
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb

    const employeeId = req.jwt.role === 'EMPLOYEE' ? req.jwt.sub : input.employeeId
    if (!employeeId) throw new AppError(400, 'employeeId es requerido')

    const rows = await tenantDb.$queryRaw<any[]>`
      INSERT INTO requests (tenant_id, employee_id, type, detail, notes, manager_id, manager_name, stage)
      VALUES (${tenantId}, ${employeeId}, ${input.type}, ${input.detail ?? null}, ${input.notes ?? null},
              ${input.managerId ?? null}, ${input.managerName ?? null}, 'MANAGER')
      RETURNING *
    `
    const request = rows[0]

    emitRequestUpdated(req, tenantId, request)

    res.status(201).json(request)
  } catch (err) {
    next(err)
  }
})

// ── GET /api/requests ─────────────────────────────────────────

router.get('/', requireEmployee, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stage, type, employeeId, page, pageSize } = listQuerySchema.parse(req.query)
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb

    // Un colaborador (rol EMPLOYEE) solo puede ver sus propias solicitudes.
    const stageParam      = stage ?? null
    const typeParam       = type ?? null
    const scopedEmployeeId = (req.jwt.role === 'EMPLOYEE' ? req.jwt.sub : employeeId) ?? null

    const offset = (page - 1) * pageSize

    const data = await tenantDb.$queryRaw<any[]>`
      SELECT * FROM requests
      WHERE tenant_id = ${tenantId}
        AND (${stageParam}::text IS NULL OR stage = ${stageParam})
        AND (${typeParam}::text IS NULL OR type = ${typeParam})
        AND (${scopedEmployeeId}::text IS NULL OR employee_id = ${scopedEmployeeId})
      ORDER BY created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `
    const totalRows = await tenantDb.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM requests
      WHERE tenant_id = ${tenantId}
        AND (${stageParam}::text IS NULL OR stage = ${stageParam})
        AND (${typeParam}::text IS NULL OR type = ${typeParam})
        AND (${scopedEmployeeId}::text IS NULL OR employee_id = ${scopedEmployeeId})
    `

    res.json({ data, total: totalRows[0]?.count ?? 0, page, pageSize })
  } catch (err) {
    next(err)
  }
})

// ── PATCH /api/requests/:id/approve ───────────────────────────
// stage MANAGER    -> WORKFORCE (avanza, pendiente de RH)
// stage WORKFORCE  -> APPROVED  (aprobación final)

router.patch('/:id/approve', requireManager, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { notes } = decisionSchema.parse(req.body)
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb

    const existing = await findRequestOr404(tenantDb, tenantId, req.params.id)
    if (existing.stage !== 'MANAGER' && existing.stage !== 'WORKFORCE') {
      throw new AppError(400, `La solicitud ya está en estado final (${existing.stage})`)
    }

    let rows: any[]
    let notifTitle: string
    let notifType: string

    if (existing.stage === 'MANAGER') {
      rows = await tenantDb.$queryRaw<any[]>`
        UPDATE requests
        SET stage = 'WORKFORCE', manager_approved_at = NOW(), manager_notes = ${notes ?? null},
            manager_id = COALESCE(manager_id, ${req.jwt.sub})
        WHERE id = ${req.params.id} AND tenant_id = ${tenantId}
        RETURNING *
      `
      notifTitle = 'Tu jefe directo aprobó tu solicitud'
      notifType  = 'REQUEST_STAGE_ADVANCED'
    } else {
      rows = await tenantDb.$queryRaw<any[]>`
        UPDATE requests
        SET stage = 'APPROVED', wkf_approved_at = NOW(), wkf_notes = ${notes ?? null}, wkf_user_id = ${req.jwt.sub}
        WHERE id = ${req.params.id} AND tenant_id = ${tenantId}
        RETURNING *
      `
      notifTitle = 'Tu solicitud fue aprobada'
      notifType  = 'REQUEST_APPROVED'
    }

    const request = rows[0]
    await insertNotification(
      tenantDb, tenantId, request.employee_id, notifType,
      notifTitle, `Actualización sobre ${requestLabel(request.type)}.`
    )
    emitRequestUpdated(req, tenantId, request)

    if (notifType === 'REQUEST_APPROVED') {
      employeeFullName(tenantDb, tenantId, request.employee_id).then((fullName) => {
        notifyHR(tenantId, 'solicitudes', `✅ CÓDICE · Solicitud aprobada\n👤 ${fullName}\n📋 ${request.type} · Folio: ${folioFor(request.id)}`)
      }) // fire-and-forget — nunca await (ver PART 3)
    }

    res.json(request)
  } catch (err) {
    next(err)
  }
})

// ── PATCH /api/requests/:id/reject ────────────────────────────
// Puede rechazarse en cualquier etapa previa a un estado final.

router.patch('/:id/reject', requireManager, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { notes } = decisionSchema.parse(req.body)
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb

    const existing = await findRequestOr404(tenantDb, tenantId, req.params.id)
    if (existing.stage === 'APPROVED' || existing.stage === 'REJECTED' || existing.stage === 'CANCELLED') {
      throw new AppError(400, `La solicitud ya está en estado final (${existing.stage})`)
    }

    const rows = existing.stage === 'MANAGER'
      ? await tenantDb.$queryRaw<any[]>`
          UPDATE requests
          SET stage = 'REJECTED', manager_notes = ${notes ?? null}, manager_id = COALESCE(manager_id, ${req.jwt.sub})
          WHERE id = ${req.params.id} AND tenant_id = ${tenantId}
          RETURNING *
        `
      : await tenantDb.$queryRaw<any[]>`
          UPDATE requests
          SET stage = 'REJECTED', wkf_notes = ${notes ?? null}, wkf_user_id = COALESCE(wkf_user_id, ${req.jwt.sub})
          WHERE id = ${req.params.id} AND tenant_id = ${tenantId}
          RETURNING *
        `
    const request = rows[0]

    await insertNotification(
      tenantDb, tenantId, request.employee_id, 'REQUEST_REJECTED',
      'Tu solicitud fue rechazada', `Actualización sobre ${requestLabel(request.type)}.`
    )
    emitRequestUpdated(req, tenantId, request)

    employeeFullName(tenantDb, tenantId, request.employee_id).then((fullName) => {
      notifyHR(tenantId, 'solicitudes', `❌ CÓDICE · Solicitud rechazada\n👤 ${fullName}\n📋 ${request.type} · Folio: ${folioFor(request.id)}`)
    }) // fire-and-forget — nunca await (ver PART 3)

    res.json(request)
  } catch (err) {
    next(err)
  }
})

export default router

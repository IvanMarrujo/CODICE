// ============================================================
// CÓDICE · Supervisor routes (Supervisor Shell)
// Endpoints para AREA_MANAGER — vista de su equipo, asistencia,
// solicitudes pendientes e incidencias de piso. Cada ruta filtra
// SIEMPRE por el equipo del supervisor (nunca el tenant completo,
// a diferencia de las rutas /api/employees usadas por RH) — ver
// getSupervisorContext()/teamWhereFragment() más abajo.
// ============================================================

import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { requireAreaManager } from '../middleware/auth'
import { AppError } from '../lib/errors'
import { prismaPublic } from '../lib/prisma'
import { notifyHR } from '../lib/whatsapp'

const router = Router()

// ── Contexto del supervisor ──────────────────────────────────
// AdminUser vive en el schema público (Prisma) — requests/employees
// viven en el schema del tenant (SQL crudo) — no hay JOIN posible entre
// ambos, así que el nombre/depto del supervisor se resuelve aparte.

interface SupervisorContext {
  fullName: string
  assignedDepartment: string | null
}

async function getSupervisorContext(req: Request): Promise<SupervisorContext> {
  const adminUser = await prismaPublic.adminUser.findUnique({
    where:  { id: req.jwt.sub },
    select: { firstName: true, lastName: true, assignedDepartment: true },
  })
  if (!adminUser) throw new AppError(404, 'Usuario supervisor no encontrado')
  return { fullName: `${adminUser.firstName} ${adminUser.lastName}`, assignedDepartment: adminUser.assignedDepartment }
}

/** IDs de empleados en el equipo del supervisor — supervisor_name coincide
 * con su nombre O department coincide con su depto asignado (OR, ver PART 1). */
async function teamEmployeeIds(tenantDb: any, tenantId: string, ctx: SupervisorContext): Promise<string[]> {
  const rows = await tenantDb.$queryRaw<{ id: string }[]>`
    SELECT id FROM employees
    WHERE tenant_id = ${tenantId}
      AND (
        supervisor_name = ${ctx.fullName}
        OR (${ctx.assignedDepartment}::text IS NOT NULL AND department = ${ctx.assignedDepartment})
      )
  `
  return rows.map((r: { id: string }) => r.id)
}

async function assertInTeam(tenantDb: any, tenantId: string, ctx: SupervisorContext, employeeId: string): Promise<void> {
  const ids = await teamEmployeeIds(tenantDb, tenantId, ctx)
  if (!ids.includes(employeeId)) throw new AppError(403, 'Ese colaborador no pertenece a tu equipo')
}

function emit(req: Request, tenantId: string, room: string, event: string, payload: unknown) {
  const io = req.app.get('io')
  io?.to(room).emit(event, payload)
}

// ── GET /api/supervisor/team ─────────────────────────────────

router.get('/team', requireAreaManager, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb
    const ctx = await getSupervisorContext(req)

    const rows = await tenantDb.$queryRaw<any[]>`
      SELECT e.id, e.full_name, e.position, e.shift, e.status, e.streak_days,
             a.check_in_at, a.check_out_at
      FROM employees e
      LEFT JOIN attendance_records a
        ON a.employee_id = e.id AND a.tenant_id = e.tenant_id AND a.check_in_at::date = CURRENT_DATE
      WHERE e.tenant_id = ${tenantId}
        AND (
          e.supervisor_name = ${ctx.fullName}
          OR (${ctx.assignedDepartment}::text IS NOT NULL AND e.department = ${ctx.assignedDepartment})
        )
      ORDER BY e.full_name ASC
    `

    const employees = rows.map((r: any) => ({
      id:             r.id,
      fullName:       r.full_name,
      position:       r.position,
      shift:          r.shift,
      status:         r.status,
      streakDays:     r.streak_days,
      lastAttendance: r.check_in_at
        ? { checkInAt: r.check_in_at, checkOutAt: r.check_out_at }
        : null,
    }))

    res.json({ employees })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/supervisor/attendance/today ─────────────────────
// "Retardo" es una aproximación: check-in después de las 9:00 hora local,
// sin importar el turno — no existe todavía una hora de inicio de turno
// configurable por colaborador/planta en el schema.

const LATE_CUTOFF_HOUR = 9

router.get('/attendance/today', requireAreaManager, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb
    const ctx = await getSupervisorContext(req)

    const rows = await tenantDb.$queryRaw<any[]>`
      SELECT e.id, e.full_name, e.position, e.shift, e.plant AS home_plant,
             a.check_in_at, a.check_out_at, a.plant AS attendance_plant, a.method
      FROM employees e
      LEFT JOIN attendance_records a
        ON a.employee_id = e.id AND a.tenant_id = e.tenant_id AND a.check_in_at::date = CURRENT_DATE
      WHERE e.tenant_id = ${tenantId} AND e.status = 'Activo'
        AND (
          e.supervisor_name = ${ctx.fullName}
          OR (${ctx.assignedDepartment}::text IS NOT NULL AND e.department = ${ctx.assignedDepartment})
        )
      ORDER BY e.full_name ASC
    `

    const employees = rows.map((r: any) => {
      const isLate = r.check_in_at && new Date(r.check_in_at).getHours() >= LATE_CUTOFF_HOUR
      return {
        employeeId:  r.id,
        name:        r.full_name,
        position:    r.position,
        shift:       r.shift,
        plant:       r.attendance_plant || r.home_plant,
        checkInAt:   r.check_in_at,
        checkOutAt:  r.check_out_at,
        method:      r.method,
        status:      !r.check_in_at ? 'sin_registrar' : isLate ? 'retardo' : 'en_planta',
      }
    })

    const present = employees.filter((e: any) => e.checkInAt).length
    const absent  = employees.length - present
    const late    = employees.filter((e: any) => e.status === 'retardo').length

    res.json({ present, absent, late, employees })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/supervisor/requests/pending ─────────────────────

router.get('/requests/pending', requireAreaManager, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb
    const ctx = await getSupervisorContext(req)
    const ids = await teamEmployeeIds(tenantDb, tenantId, ctx)

    if (ids.length === 0) return res.json({ data: [] })

    const data = await tenantDb.$queryRaw<any[]>`
      SELECT r.*, e.full_name AS employee_name, e.avatar_url AS employee_photo
      FROM requests r
      JOIN employees e ON e.id = r.employee_id AND e.tenant_id = r.tenant_id
      WHERE r.tenant_id = ${tenantId} AND r.stage = 'MANAGER' AND r.employee_id = ANY(${ids})
      ORDER BY r.created_at ASC
    `
    res.json({ data })
  } catch (err) {
    next(err)
  }
})

// ── PATCH /api/supervisor/requests/:id/approve ───────────────
// PATCH /api/supervisor/requests/:id/reject ────────────────
// Misma lógica que PATCH /api/requests/:id/(approve|reject) — ver
// routes/requests.ts — pero primero valida que el colaborador dueño
// de la solicitud pertenece al equipo de este supervisor.

const decisionSchema = z.object({ notes: z.string().optional() })

const REQUEST_TYPE_LABEL: Record<string, string> = {
  'Vacaciones':             'tu solicitud de vacaciones',
  'Permiso':                'tu permiso',
  'Constancia laboral':     'tu constancia laboral',
  'Cambio de turno':        'tu cambio de turno',
  'Anticipo de nómina':     'tu anticipo de nómina',
  'Actualización de datos': 'tu actualización de datos',
}
function requestLabel(type: string) { return REQUEST_TYPE_LABEL[type] || `tu solicitud (${type})` }
function folioFor(id: string) { return id.slice(0, 8).toUpperCase() }

async function findTeamRequestOr404(tenantDb: any, tenantId: string, ctx: SupervisorContext, id: string) {
  const rows = await tenantDb.$queryRaw<any[]>`SELECT * FROM requests WHERE id = ${id} AND tenant_id = ${tenantId} LIMIT 1`
  const request = rows[0]
  if (!request) throw new AppError(404, 'Solicitud no encontrada')
  await assertInTeam(tenantDb, tenantId, ctx, request.employee_id)
  return request
}

async function insertNotification(tenantDb: any, tenantId: string, employeeId: string, type: string, title: string, body: string) {
  await tenantDb.$executeRaw`
    INSERT INTO notifications (tenant_id, employee_id, type, title, body)
    VALUES (${tenantId}, ${employeeId}, ${type}, ${title}, ${body})
  `
}

async function employeeFullName(tenantDb: any, tenantId: string, employeeId: string): Promise<string> {
  const rows = await tenantDb.$queryRaw<{ full_name: string }[]>`SELECT full_name FROM employees WHERE id = ${employeeId} AND tenant_id = ${tenantId} LIMIT 1`
  return rows[0]?.full_name || 'Colaborador'
}

router.patch('/requests/:id/approve', requireAreaManager, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { notes } = decisionSchema.parse(req.body)
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb
    const ctx = await getSupervisorContext(req)

    const existing = await findTeamRequestOr404(tenantDb, tenantId, ctx, req.params.id)
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
    await insertNotification(tenantDb, tenantId, request.employee_id, notifType, notifTitle, `Actualización sobre ${requestLabel(request.type)}.`)
    emit(req, tenantId, `tenant:${tenantId}`, 'request:updated', request)

    employeeFullName(tenantDb, tenantId, request.employee_id).then((fullName) => {
      notifyHR(tenantId, 'solicitudes', `✅ CÓDICE · Solicitud ${existing.stage === 'MANAGER' ? 'aprobada por supervisor' : 'aprobada'}\n👤 ${fullName}\n📋 ${request.type} · Folio: ${folioFor(request.id)}`)
    }) // fire-and-forget — nunca await (ver requests.ts)

    res.json(request)
  } catch (err) {
    next(err)
  }
})

router.patch('/requests/:id/reject', requireAreaManager, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { notes } = decisionSchema.parse(req.body)
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb
    const ctx = await getSupervisorContext(req)

    const existing = await findTeamRequestOr404(tenantDb, tenantId, ctx, req.params.id)
    if (existing.stage === 'APPROVED' || existing.stage === 'REJECTED' || existing.stage === 'CANCELLED') {
      throw new AppError(400, `La solicitud ya está en estado final (${existing.stage})`)
    }

    const rows = existing.stage === 'MANAGER'
      ? await tenantDb.$queryRaw<any[]>`
          UPDATE requests SET stage = 'REJECTED', manager_notes = ${notes ?? null}, manager_id = COALESCE(manager_id, ${req.jwt.sub})
          WHERE id = ${req.params.id} AND tenant_id = ${tenantId} RETURNING *
        `
      : await tenantDb.$queryRaw<any[]>`
          UPDATE requests SET stage = 'REJECTED', wkf_notes = ${notes ?? null}, wkf_user_id = COALESCE(wkf_user_id, ${req.jwt.sub})
          WHERE id = ${req.params.id} AND tenant_id = ${tenantId} RETURNING *
        `
    const request = rows[0]

    await insertNotification(tenantDb, tenantId, request.employee_id, 'REQUEST_REJECTED', 'Tu solicitud fue rechazada', `Actualización sobre ${requestLabel(request.type)}.`)
    emit(req, tenantId, `tenant:${tenantId}`, 'request:updated', request)

    employeeFullName(tenantDb, tenantId, request.employee_id).then((fullName) => {
      notifyHR(tenantId, 'solicitudes', `❌ CÓDICE · Solicitud rechazada por supervisor\n👤 ${fullName}\n📋 ${request.type} · Folio: ${folioFor(request.id)}`)
    }) // fire-and-forget

    res.json(request)
  } catch (err) {
    next(err)
  }
})

// ── POST /api/supervisor/incidents ───────────────────────────

const INCIDENT_TYPES = [
  'Retardo', 'Falta injustificada', 'Accidente leve', 'Accidente moderado/grave',
  'Conducta inapropiada', 'Daño a equipo',
] as const

const incidentSchema = z.object({
  employeeId:  z.string().min(1),
  type:        z.enum(INCIDENT_TYPES),
  description: z.string().optional(),
  severity:    z.enum(['leve', 'moderado', 'grave']),
})

router.post('/incidents', requireAreaManager, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = incidentSchema.parse(req.body)
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb
    const ctx = await getSupervisorContext(req)
    await assertInTeam(tenantDb, tenantId, ctx, input.employeeId)

    const rows = await tenantDb.$queryRaw<any[]>`
      INSERT INTO supervisor_incidents (tenant_id, employee_id, reported_by, type, description, severity)
      VALUES (${tenantId}, ${input.employeeId}, ${req.jwt.sub}, ${input.type}, ${input.description ?? null}, ${input.severity})
      RETURNING *
    `
    const incident = rows[0]
    emit(req, tenantId, `tenant:${tenantId}`, 'incident:created', incident)

    if (input.severity === 'grave') {
      const [fullName, plantRows] = await Promise.all([
        employeeFullName(tenantDb, tenantId, input.employeeId),
        tenantDb.$queryRaw<{ plant: string }[]>`SELECT plant FROM employees WHERE id = ${input.employeeId} AND tenant_id = ${tenantId} LIMIT 1`,
      ])
      const plant = plantRows[0]?.plant || 'planta no especificada'
      // Urgente — sí se espera (a diferencia del resto de notifyHR en este
      // archivo) para que un fallo de envío quede reflejado en la respuesta.
      await notifyHR(
        tenantId, 'seguridad',
        `🔴 CÓDICE · Incidencia grave\nSupervisor ${ctx.fullName} registró: ${input.type}\nEmpleado: ${fullName}\nPlanta: ${plant}\nRevisa inmediatamente.`
      )
    }

    res.status(201).json(incident)
  } catch (err) {
    next(err)
  }
})

// ── GET /api/supervisor/incidents (historial del supervisor) ─

router.get('/incidents', requireAreaManager, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb

    const data = await tenantDb.$queryRaw<any[]>`
      SELECT si.*, e.full_name AS employee_name
      FROM supervisor_incidents si
      JOIN employees e ON e.id = si.employee_id AND e.tenant_id = si.tenant_id
      WHERE si.tenant_id = ${tenantId} AND si.reported_by = ${req.jwt.sub}
        AND si.created_at >= NOW() - INTERVAL '30 days'
      ORDER BY si.created_at DESC
    `
    res.json({ data })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/supervisor/team/:id/profile ─────────────────────
// Perfil "seguro" — nunca salario, RFC, CURP, NSS ni datos bancarios.

router.get('/team/:id/profile', requireAreaManager, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb
    const ctx = await getSupervisorContext(req)
    await assertInTeam(tenantDb, tenantId, ctx, req.params.id)

    const empRows = await tenantDb.$queryRaw<any[]>`
      SELECT id, full_name, position, shift, plant, streak_days
      FROM employees WHERE id = ${req.params.id} AND tenant_id = ${tenantId} LIMIT 1
    `
    const employee = empRows[0]
    if (!employee) throw new AppError(404, 'Empleado no encontrado')

    const [attendance30, pendingRequests, courses] = await Promise.all([
      tenantDb.$queryRaw<any[]>`
        SELECT check_in_at::date AS date, check_in_at, check_out_at
        FROM attendance_records
        WHERE employee_id = ${req.params.id} AND tenant_id = ${tenantId}
          AND check_in_at >= NOW() - INTERVAL '30 days'
        ORDER BY check_in_at DESC
      `,
      tenantDb.$queryRaw<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM requests
        WHERE employee_id = ${req.params.id} AND tenant_id = ${tenantId} AND stage IN ('MANAGER', 'WORKFORCE')
      `,
      tenantDb.$queryRaw<{ total: number; passed: number }[]>`
        SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE passed)::int AS passed
        FROM course_progress WHERE employee_id = ${req.params.id} AND tenant_id = ${tenantId}
      `,
    ])

    res.json({
      id:                    employee.id,
      fullName:              employee.full_name,
      position:              employee.position,
      shift:                 employee.shift,
      plant:                 employee.plant,
      streakDays:            employee.streak_days,
      attendanceLast30Days:  attendance30,
      pendingRequests:       pendingRequests[0]?.count ?? 0,
      coursesStatus:         { total: courses[0]?.total ?? 0, passed: courses[0]?.passed ?? 0 },
    })
  } catch (err) {
    next(err)
  }
})

export default router

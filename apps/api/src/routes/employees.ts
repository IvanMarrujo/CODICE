// ============================================================
// CÓDICE · Employees routes
// CRUD sobre la tabla `employees` del schema del tenant.
// req.tenantDb ya tiene el search_path apuntando al tenant
// (ver middleware/tenant.ts) — las queries no califican el schema.
// ============================================================

import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { requireHR } from '../middleware/auth'
import { AppError } from '../lib/errors'

const router = Router()

// ── Validación ────────────────────────────────────────────────

const listQuerySchema = z.object({
  status:     z.string().optional(),
  department: z.string().optional(),
  plant:      z.string().optional(),
  shift:      z.string().optional(),
  search:     z.string().optional(),
  page:       z.coerce.number().int().min(1).default(1),
  pageSize:   z.coerce.number().int().min(1).max(100).default(20),
})

const employeeInputSchema = z.object({
  employeeCode:  z.string().optional(),
  rfc:           z.string().optional(),
  curp:          z.string().optional(),
  nss:           z.string().optional(),
  firstName:     z.string().min(1).optional(),
  lastName:      z.string().min(1).optional(),
  department:    z.string().optional(),
  position:      z.string().optional(),
  plant:         z.string().optional(),
  shift:         z.string().optional(),
  contractType:  z.string().optional(),
  hireDate:      z.string().optional(),       // ISO date
  dailySalary:   z.number().optional(),
  monthlySalary: z.number().optional(),
  email:         z.string().email().optional(),
  phone:         z.string().optional(),
  status:        z.string().optional(),
  notes:         z.string().optional(),
})

const createSchema = employeeInputSchema.extend({
  firstName: z.string().min(1),
  lastName:  z.string().min(1),
})

// camelCase (API) -> snake_case (columna real). Whitelist fija: nunca se
// interpola un nombre de columna que venga directo del cliente.
const COLUMN_MAP: Record<string, string> = {
  employeeCode:  'employee_code',
  rfc:           'rfc',
  curp:          'curp',
  nss:           'nss',
  firstName:     'first_name',
  lastName:      'last_name',
  department:    'department',
  position:      'position',
  plant:         'plant',
  shift:         'shift',
  contractType:  'contract_type',
  hireDate:      'hire_date',
  dailySalary:   'daily_salary',
  monthlySalary: 'monthly_salary',
  email:         'email',
  phone:         'phone',
  status:        'status',
  notes:         'notes',
}

// ── Helpers ───────────────────────────────────────────────────

export async function insertAuditLog(
  tenantDb: any,
  tenantId: string,
  req: Request,
  action: string,
  resource: string,
  changes: unknown
) {
  await tenantDb.$executeRaw`
    INSERT INTO audit_log (tenant_id, actor_id, actor_type, actor_email, action, resource, changes, ip)
    VALUES (${tenantId}, ${req.jwt.sub}, 'admin', ${req.jwt.email}, ${action}, ${resource}, ${JSON.stringify(changes)}::jsonb, ${req.ip})
  `
}

function emitEmployeeUpdated(req: Request, tenantId: string, employee: unknown) {
  const io = req.app.get('io')
  io?.to(`tenant:${tenantId}`).emit('employee:updated', employee)
}

export async function findEmployeeOr404(tenantDb: any, tenantId: string, id: string) {
  const rows = await tenantDb.$queryRaw<any[]>`
    SELECT * FROM employees WHERE id = ${id} AND tenant_id = ${tenantId} LIMIT 1
  `
  if (!rows[0]) throw new AppError(404, 'Empleado no encontrado')
  return rows[0]
}

// ── GET /api/employees ───────────────────────────────────────
// Lista paginada con filtros y búsqueda difusa (pg_trgm) sobre full_name.

router.get('/', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, department, plant, shift, search, page, pageSize } = listQuerySchema.parse(req.query)
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb

    const conditions: Prisma.Sql[] = [Prisma.sql`tenant_id = ${tenantId}`]
    conditions.push(status ? Prisma.sql`status = ${status}` : Prisma.sql`status != 'Baja'`)
    if (department) conditions.push(Prisma.sql`department = ${department}`)
    if (plant)      conditions.push(Prisma.sql`plant = ${plant}`)
    if (shift)      conditions.push(Prisma.sql`shift = ${shift}`)
    if (search) {
      conditions.push(Prisma.sql`(full_name ILIKE ${'%' + search + '%'} OR similarity(full_name, ${search}) > 0.15)`)
    }

    const whereSql  = Prisma.join(conditions, ' AND ')
    const orderSql  = search
      ? Prisma.sql`ORDER BY similarity(full_name, ${search}) DESC`
      : Prisma.sql`ORDER BY created_at DESC`
    const offset = (page - 1) * pageSize

    const [data, totalRows] = await Promise.all([
      tenantDb.$queryRaw<any[]>`
        SELECT id, employee_code, rfc, curp, first_name, last_name, full_name, department, position,
               plant, shift, contract_type, hire_date, daily_salary, monthly_salary, email, phone,
               status, xp_points, xp_level, created_at
        FROM employees
        WHERE ${whereSql}
        ${orderSql}
        LIMIT ${pageSize} OFFSET ${offset}
      `,
      tenantDb.$queryRaw<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM employees WHERE ${whereSql}`,
    ])

    res.json({ data, total: totalRows[0]?.count ?? 0, page, pageSize })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/employees/status-summary ─────────────────────────
// Conteo por status para el donut de "Status de plantilla" en el Cockpit.
// Debe registrarse ANTES de '/:id' — si no, Express matchea
// "/status-summary" contra el parámetro :id.

const KNOWN_STATUSES = [
  'Activo', 'Vacaciones', 'Incapacidad', 'Permiso',
  'Baja pendiente', 'Periodo de prueba', 'Baja',
]

router.get('/status-summary', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb

    const rows = await tenantDb.$queryRaw<{ status: string; count: number }[]>`
      SELECT status, COUNT(*)::int AS count FROM employees WHERE tenant_id = ${tenantId} GROUP BY status
    `

    const summary: Record<string, number> = {}
    for (const s of KNOWN_STATUSES) summary[s] = 0
    let total = 0
    for (const row of rows) {
      summary[row.status] = (summary[row.status] ?? 0) + row.count
      total += row.count
    }
    summary.total = total

    res.json(summary)
  } catch (err) {
    next(err)
  }
})

// ── GET /api/employees/:id ───────────────────────────────────

router.get('/:id', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const employee = await findEmployeeOr404(req.tenantDb, req.tenant.id, req.params.id)
    res.json(employee)
  } catch (err) {
    next(err)
  }
})

// ── POST /api/employees ──────────────────────────────────────

router.post('/', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createSchema.parse(req.body)
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb

    const entries = Object.entries(input).filter(([, v]) => v !== undefined) as [string, unknown][]
    const columns = entries.map(([k]) => Prisma.raw(COLUMN_MAP[k]))
    const values  = entries.map(([, v]) => v)

    const columnsSql = Prisma.join([Prisma.raw('tenant_id'), ...columns], ', ')
    const valuesSql  = Prisma.join([tenantId, ...values], ', ')

    const rows = await tenantDb.$queryRaw<any[]>`
      INSERT INTO employees (${columnsSql}) VALUES (${valuesSql}) RETURNING *
    `
    const employee = rows[0]

    await insertAuditLog(tenantDb, tenantId, req, 'employee.created', `employee:${employee.id}`, { after: employee })
    emitEmployeeUpdated(req, tenantId, employee)

    res.status(201).json(employee)
  } catch (err) {
    next(err)
  }
})

// ── PATCH /api/employees/:id ──────────────────────────────────

router.patch('/:id', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = employeeInputSchema.parse(req.body)
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb

    const entries = Object.entries(input).filter(([, v]) => v !== undefined) as [string, unknown][]
    if (entries.length === 0) throw new AppError(400, 'No se enviaron campos para actualizar')

    const before = await findEmployeeOr404(tenantDb, tenantId, req.params.id)

    const setFragments = entries.map(([k, v]) => Prisma.sql`${Prisma.raw(COLUMN_MAP[k])} = ${v}`)

    const rows = await tenantDb.$queryRaw<any[]>`
      UPDATE employees SET ${Prisma.join(setFragments, ', ')}
      WHERE id = ${req.params.id} AND tenant_id = ${tenantId}
      RETURNING *
    `
    const employee = rows[0]

    await insertAuditLog(tenantDb, tenantId, req, 'employee.updated', `employee:${employee.id}`, { before, after: employee })
    emitEmployeeUpdated(req, tenantId, employee)

    res.json(employee)
  } catch (err) {
    next(err)
  }
})

// ── DELETE /api/employees/bulk ────────────────────────────────
// "Limpiar plantilla": soft delete de TODOS los empleados activos del
// tenant (status != 'Baja' ya). Debe registrarse ANTES de '/:id' — si no,
// Express matchea "/bulk" contra el parámetro :id (cualquier string).
// Los recibos de nómina NO se tocan.

router.delete('/bulk', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb

    const updated = await tenantDb.$queryRaw<{ id: string }[]>`
      UPDATE employees SET status = 'Baja', termination_date = CURRENT_DATE
      WHERE tenant_id = ${tenantId} AND status != 'Baja'
      RETURNING id
    `

    await insertAuditLog(tenantDb, tenantId, req, 'employee.bulk_deleted', `tenant:${tenantId}`, { updated: updated.length })

    const io = req.app.get('io')
    io?.to(`tenant:${tenantId}`).emit('employees:bulk_changed', { updated: updated.length })
    io?.to(`tenant:${tenantId}`).emit('headcount:refresh', {})

    res.json({ updated: updated.length })
  } catch (err) {
    next(err)
  }
})

// ── DELETE /api/employees/:id ─────────────────────────────────
// Soft delete: marca status='Baja' + termination_date, no borra el registro.

router.delete('/:id', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb

    const before = await findEmployeeOr404(tenantDb, tenantId, req.params.id)

    const rows = await tenantDb.$queryRaw<any[]>`
      UPDATE employees SET status = 'Baja', termination_date = CURRENT_DATE
      WHERE id = ${req.params.id} AND tenant_id = ${tenantId}
      RETURNING *
    `
    const employee = rows[0]

    await insertAuditLog(tenantDb, tenantId, req, 'employee.deleted', `employee:${employee.id}`, { before, after: employee })
    emitEmployeeUpdated(req, tenantId, employee)

    res.json(employee)
  } catch (err) {
    next(err)
  }
})

export default router

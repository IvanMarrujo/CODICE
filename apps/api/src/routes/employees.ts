// ============================================================
// CÓDICE · Employees routes
// CRUD sobre la tabla `employees` del schema del tenant.
// req.tenantDb ya tiene el search_path apuntando al tenant
// (ver middleware/tenant.ts) — las queries no califican el schema.
// ============================================================

import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { requireHR, requireEmployee } from '../middleware/auth'
import { AppError } from '../lib/errors'
import { paginationQuerySchema, resolvePageSize, paginationMeta } from '../lib/pagination'
import { calculateLevel, unlockedCourses, BADGES } from '../lib/gamification'

const router = Router()

// ── Validación ────────────────────────────────────────────────

// page/limit/pageSize: ver lib/pagination.ts. `pageSize` (tope 2000) es el
// nombre legacy que usa fetchEmployees(token) para traer el tenant COMPLETO
// de una sola vez (Cockpit, Indicadores, dropdowns, etc. necesitan el roster
// entero en memoria) — se conserva sin tocar su tope, ver investigación
// "IMPORT DEBUG" (Plantilla truncaba en 100 antes de esa subida). `limit`
// es el nombre nuevo para la paginación real de la UI de Plantilla (tope 100).
const listQuerySchema = z.object({
  status:     z.string().optional(),
  department: z.string().optional(),
  plant:      z.string().optional(),
  shift:      z.string().optional(),
  search:     z.string().optional(),
}).merge(paginationQuerySchema)

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
  // Edición inline de "Campos adicionales" en Expediente → Perfil — merge,
  // no overwrite (ver más abajo), así PATCHear un campo no borra los demás.
  customFields:  z.record(z.string()).optional(),
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
    const parsed = listQuerySchema.parse(req.query)
    const { status, department, plant, shift, search, page } = parsed
    const pageSize = resolvePageSize(parsed)
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
               status, xp_points, xp_level, created_at, seniority_years
        FROM employees
        WHERE ${whereSql}
        ${orderSql}
        LIMIT ${pageSize} OFFSET ${offset}
      `,
      tenantDb.$queryRaw<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM employees WHERE ${whereSql}`,
    ])

    const total = totalRows[0]?.count ?? 0
    // `data` (legacy) y `employees` (nombre pedido por la spec de paginación)
    // son el mismo arreglo — así ni fetchEmployees() ni la nueva UI de
    // Plantilla paginada tienen que cambiar de contrato.
    res.json({ data, employees: data, ...paginationMeta(page, pageSize, total) })
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

// ── GET /api/employees/team ───────────────────────────────────
// "Conoce a tu equipo" (shell colaborador) — solo campos seguros para
// mostrar en el grafo de compañeros. Nunca salario/RFC/CURP/NSS/banco.
// requireEmployee (no requireHR): la usa el propio colaborador, no solo RH.

const AVATAR_PALETTE = [
  '#00c896', '#4db8ff', '#f5c518', '#a78bfa', '#f97316',
  '#34d399', '#f472b6', '#60a5fa', '#fb923c', '#22d3ee',
]

function avatarColorFor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length]
}

function initialsFor(firstName: string, lastName: string): string {
  return `${(firstName || '?')[0] ?? ''}${(lastName || '')[0] ?? ''}`.toUpperCase()
}

router.get('/team', requireEmployee, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const department = String(req.query.department || '')
    if (!department) throw new AppError(400, 'Falta el parámetro department')

    const rows = await req.tenantDb.$queryRaw<any[]>`
      SELECT id, first_name, last_name, position, department, shift, plant, avatar_url
      FROM employees
      WHERE tenant_id = ${tenantId} AND department = ${department} AND status = 'Activo'
      ORDER BY first_name
      LIMIT 200
    `

    const employees = rows.map((r: any) => ({
      id:          r.id,
      firstName:   r.first_name,
      lastName:    r.last_name,
      position:    r.position,
      department:  r.department,
      shift:       r.shift,
      plant:       r.plant,
      photoUrl:    r.avatar_url || null,
      initials:    initialsFor(r.first_name, r.last_name),
      avatarColor: avatarColorFor(`${r.first_name} ${r.last_name}`),
    }))

    res.json({ employees })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/employees/leaderboard ───────────────────────────
// "/leaderboard" debe montarse ANTES que "/:id" — un solo segmento,
// matchearía contra el parámetro (mismo gotcha que "/team" y
// "/status-summary" arriba).

router.get('/leaderboard', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 5))

    const rows = await req.tenantDb.$queryRaw<any[]>`
      SELECT id, first_name, last_name, department, avatar_url, xp_points, xp_level, streak_days
      FROM employees
      WHERE tenant_id = ${tenantId} AND status = 'Activo'
      ORDER BY xp_points DESC
      LIMIT ${limit}
    `

    const data = rows.map((r: any) => ({
      id:          r.id,
      firstName:   r.first_name,
      lastName:    r.last_name,
      department:  r.department,
      photoUrl:    r.avatar_url || null,
      initials:    initialsFor(r.first_name, r.last_name),
      avatarColor: avatarColorFor(`${r.first_name} ${r.last_name}`),
      xpTotal:     r.xp_points,
      xpLevel:     r.xp_level,
      levelLabel:  calculateLevel(r.xp_points).label,
      streakDays:  r.streak_days,
    }))

    res.json({ data })
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

// ── GET /api/employees/:id/gamification ──────────────────────
// El propio colaborador ve su progreso; RH puede consultar el de
// cualquiera (Expediente → tab Perfil).

const GAMIFICATION_DEFAULTS = {
  xp_total: 0, xp_level: 1, level_label: 'Inicio', streak_days: 0,
  badges: BADGES.map((b) => ({ ...b, unlocked: false })),
  xp_to_next_level: 100, progress_pct: 0,
  recent_events: [] as unknown[], unlocked_courses: [] as string[],
}

router.get('/:id/gamification', requireEmployee, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const targetId = req.params.id
    if (req.jwt.role === 'EMPLOYEE' && req.jwt.sub !== targetId) {
      throw new AppError(403, 'No puedes ver la gamificación de otro colaborador')
    }

    const employee = await findEmployeeOr404(req.tenantDb, tenantId, targetId)

    // `badges`/`xp_events` son un backfill (ver scripts/migrateGamification.ts)
    // — en un tenant donde todavía no corrió, `employee.badges` sale
    // undefined (columna inexistente en un SELECT *) y la tabla `xp_events`
    // ni existe. Ninguno de los dos debe tumbar el endpoint: el colaborador
    // simplemente ve su progreso en cero hasta que el backfill corra.
    const xpTotal    = employee.xp_points ?? 0
    const xpLevel    = employee.xp_level ?? 1
    const streakDays = employee.streak_days ?? 0
    const earnedBadges: string[] = Array.isArray(employee.badges) ? employee.badges : []

    const recentEvents = await req.tenantDb.$queryRaw<any[]>`
      SELECT type, xp_earned, description, created_at
      FROM xp_events
      WHERE employee_id = ${targetId}
      ORDER BY created_at DESC
      LIMIT 10
    `.catch((err: any) => {
      console.error(`⚠️  gamification: xp_events no disponible todavía para tenant ${tenantId} (¿falta migrateGamification.ts?):`, err.message)
      return [] as any[]
    })

    const { label, xpToNext, progressPct } = calculateLevel(xpTotal)

    res.json({
      xp_total:           xpTotal,
      xp_level:            xpLevel,
      level_label:        label,
      streak_days:        streakDays,
      badges:             BADGES.map((b) => ({ ...b, unlocked: earnedBadges.includes(b.id) })),
      xp_to_next_level:   xpToNext,
      progress_pct:       progressPct,
      recent_events:      recentEvents,
      unlocked_courses:   unlockedCourses(xpLevel),
    })
  } catch (err: any) {
    // Cualquier otra falla inesperada (ej. tabla `employees` sin las
    // columnas de gamificación todavía) — el colaborador ve valores en
    // cero en vez de un 500, y el detalle queda logueado para RH/soporte.
    console.error(`❌  GET /employees/${req.params.id}/gamification falló:`, err.message)
    if (err instanceof AppError) return next(err)
    res.json(GAMIFICATION_DEFAULTS)
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
    const { customFields, ...rest } = employeeInputSchema.parse(req.body)
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb

    const entries = Object.entries(rest).filter(([, v]) => v !== undefined) as [string, unknown][]
    if (entries.length === 0 && !customFields) throw new AppError(400, 'No se enviaron campos para actualizar')

    const before = await findEmployeeOr404(tenantDb, tenantId, req.params.id)

    const setFragments = entries.map(([k, v]) => Prisma.sql`${Prisma.raw(COLUMN_MAP[k])} = ${v}`)
    if (customFields) {
      setFragments.push(Prisma.sql`custom_fields = COALESCE(custom_fields, '{}'::jsonb) || ${JSON.stringify(customFields)}::jsonb`)
    }

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

// ============================================================
// CÓDICE · Attendance routes (MOCK)
// No hay checadora física conectada — este módulo simula el
// check-in/check-out de colaboradores (pensado para integrarse más
// adelante con checadoras biométricas ZKTeco/Anviz vía SDK/REST).
// Un registro por colaborador por día: check-in crea la fila,
// check-out la completa.
// ============================================================

import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { requireEmployee } from '../middleware/auth'
import { AppError } from '../lib/errors'

const router = Router()

const listQuerySchema = z.object({
  date:       z.string().optional(), // YYYY-MM-DD, default hoy
  employeeId: z.string().optional(),
})

const checkinSchema = z.object({
  employeeId: z.string().optional(), // opcional si el propio empleado hace check-in
  plant:      z.string().optional(),
  method:     z.enum(['QR', 'MANUAL', 'KIOSK']).default('QR'),
})

const checkoutSchema = z.object({
  employeeId: z.string().optional(),
})

function emitAttendance(req: Request, tenantId: string, eventName: string, payload: unknown) {
  const io = req.app.get('io')
  io?.to(`tenant:${tenantId}`).emit(eventName, payload)
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

// Nombres/planta de demo para las filas semilla — el mock necesita verse
// "vivo" en la primera carga sin que nadie haya usado la app todavía.
const SEED_PLANTS = ['Planta Vallejo · Acceso principal', 'Planta Vallejo · Andén de carga', 'CEDIS Tláhuac · Acceso principal']

async function seedIfEmpty(tenantDb: any, tenantId: string, date: string) {
  if (date !== todayISO()) return // solo se siembra el día de hoy

  const existing = await tenantDb.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM attendance_records
    WHERE tenant_id = ${tenantId} AND check_in_at::date = ${date}::date
  `
  if ((existing[0]?.count ?? 0) > 0) return

  const candidates = await tenantDb.$queryRaw<any[]>`
    SELECT id, plant FROM employees
    WHERE tenant_id = ${tenantId} AND status = 'Activo'
    ORDER BY created_at ASC
    LIMIT 4
  `
  if (candidates.length === 0) return

  for (let i = 0; i < candidates.length; i++) {
    const emp = candidates[i]
    // Entradas escalonadas entre 07:52 y 08:14 de hoy — se ven "reales".
    const minutesOffset = 52 + i * 7 + Math.floor(Math.random() * 5)
    await tenantDb.$executeRaw`
      INSERT INTO attendance_records (tenant_id, employee_id, check_in_at, plant, method)
      VALUES (
        ${tenantId}, ${emp.id},
        (${date}::date + TIME '07:00:00' + (${minutesOffset} || ' minutes')::interval) AT TIME ZONE 'America/Mexico_City',
        ${emp.plant || SEED_PLANTS[i % SEED_PLANTS.length]},
        'MOCK_SEED'
      )
    `
  }
}

// ── GET /api/attendance ───────────────────────────────────────
// Headcount del día: LEFT JOIN de empleados activos con su registro de
// asistencia de esa fecha (si no checaron, check_in_at sale NULL —
// eso es lo que pinta "Sin registro" en el frontend).

router.get('/', requireEmployee, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { date: dateInput, employeeId: queryEmployeeId } = listQuerySchema.parse(req.query)
    const date = dateInput || todayISO()
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb

    const scopedEmployeeId = req.jwt.role === 'EMPLOYEE' ? req.jwt.sub : (queryEmployeeId ?? null)

    if (!scopedEmployeeId) await seedIfEmpty(tenantDb, tenantId, date)

    const rows = await tenantDb.$queryRaw<any[]>`
      SELECT
        e.id AS employee_id, e.employee_code, e.full_name, e.department, e.position, e.shift, e.plant AS home_plant,
        a.id AS attendance_id, a.check_in_at, a.check_out_at, a.plant AS attendance_plant, a.method
      FROM employees e
      LEFT JOIN attendance_records a
        ON a.employee_id = e.id AND a.tenant_id = e.tenant_id AND a.check_in_at::date = ${date}::date
      WHERE e.tenant_id = ${tenantId}
        AND e.status = 'Activo'
        AND (${scopedEmployeeId}::text IS NULL OR e.id = ${scopedEmployeeId})
      ORDER BY e.full_name ASC
    `

    const data = rows.map((r: any) => ({
      employeeId:   r.employee_id,
      employeeCode: r.employee_code,
      name:         r.full_name,
      department:   r.department,
      position:     r.position,
      shift:        r.shift,
      plant:        r.attendance_plant || r.home_plant,
      attendanceId: r.attendance_id,
      checkInAt:    r.check_in_at,
      checkOutAt:   r.check_out_at,
      method:       r.method,
    }))

    const totalActive = data.length
    const checkedIn   = data.filter((d: any) => d.checkInAt && !d.checkOutAt).length
    const checkedOut  = data.filter((d: any) => d.checkOutAt).length
    const noRecord    = data.filter((d: any) => !d.checkInAt).length

    res.json({ date, data, totalActive, checkedIn, checkedOut, noRecord })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/attendance/checkin ────────────────────────────────

router.post('/checkin', requireEmployee, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = checkinSchema.parse(req.body)
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb

    const employeeId = req.jwt.role === 'EMPLOYEE' ? req.jwt.sub : input.employeeId
    if (!employeeId) throw new AppError(400, 'employeeId es requerido')

    const empRows = await tenantDb.$queryRaw<any[]>`
      SELECT id, employee_code, full_name, department, plant FROM employees
      WHERE id = ${employeeId} AND tenant_id = ${tenantId} LIMIT 1
    `
    const employee = empRows[0]
    if (!employee) throw new AppError(404, 'Colaborador no encontrado')

    const existing = await tenantDb.$queryRaw<any[]>`
      SELECT * FROM attendance_records
      WHERE employee_id = ${employeeId} AND tenant_id = ${tenantId} AND check_in_at::date = CURRENT_DATE
      LIMIT 1
    `
    if (existing[0]) {
      // Idempotente — doble tap no debe romper el flujo, solo devuelve lo que ya hay.
      return res.status(200).json({ ...existing[0], employeeCode: employee.employee_code, name: employee.full_name })
    }

    const plant = input.plant || employee.plant || 'Planta Vallejo · Acceso principal'

    const rows = await tenantDb.$queryRaw<any[]>`
      INSERT INTO attendance_records (tenant_id, employee_id, check_in_at, plant, method)
      VALUES (${tenantId}, ${employeeId}, NOW(), ${plant}, ${input.method})
      RETURNING *
    `
    const record = rows[0]
    const payload = {
      ...record,
      employeeCode: employee.employee_code,
      name: employee.full_name,
      department: employee.department,
    }

    emitAttendance(req, tenantId, 'attendance:checkin', payload)

    res.status(201).json(payload)
  } catch (err) {
    next(err)
  }
})

// ── POST /api/attendance/checkout ───────────────────────────────

router.post('/checkout', requireEmployee, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = checkoutSchema.parse(req.body)
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb

    const employeeId = req.jwt.role === 'EMPLOYEE' ? req.jwt.sub : input.employeeId
    if (!employeeId) throw new AppError(400, 'employeeId es requerido')

    const existing = await tenantDb.$queryRaw<any[]>`
      SELECT * FROM attendance_records
      WHERE employee_id = ${employeeId} AND tenant_id = ${tenantId} AND check_in_at::date = CURRENT_DATE
      LIMIT 1
    `
    if (!existing[0]) throw new AppError(400, 'No hay una entrada registrada hoy')
    if (existing[0].check_out_at) throw new AppError(400, 'Ya registraste tu salida hoy')

    const rows = await tenantDb.$queryRaw<any[]>`
      UPDATE attendance_records SET check_out_at = NOW()
      WHERE id = ${existing[0].id} AND tenant_id = ${tenantId}
      RETURNING *
    `
    const record = rows[0]

    const empRows = await tenantDb.$queryRaw<any[]>`
      SELECT employee_code, full_name, department FROM employees WHERE id = ${employeeId} AND tenant_id = ${tenantId} LIMIT 1
    `
    const employee = empRows[0] || {}
    const payload = { ...record, employeeCode: employee.employee_code, name: employee.full_name, department: employee.department }

    emitAttendance(req, tenantId, 'attendance:checkout', payload)

    res.json(payload)
  } catch (err) {
    next(err)
  }
})

export default router

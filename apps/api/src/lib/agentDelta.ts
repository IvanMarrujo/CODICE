// ============================================================
// CÓDICE · Agent WebSocket — aplicación de deltas
// Traduce los deltas que manda el agente (packages/agent/src/diffEngine.ts)
// a updates puntuales sobre employees/payroll_records/attendance_records,
// reusando los mismos upserts whitelisted que ya usa el ETL de archivo
// completo (routes/connectors.ts) — un delta y un reload manual del mismo
// archivo convergen exactamente al mismo estado, y las columnas escribibles
// nunca vienen de un nombre de campo que mande el agente sin filtrar.
// ============================================================

import { Prisma } from '@prisma/client'
import {
  upsertEmployee,
  upsertPayrollRecord,
  WRITABLE_EMPLOYEE_COLUMNS,
  WRITABLE_PAYROLL_COLUMNS,
} from '../routes/connectors'
import { EmployeeUpsertRow, PayrollUpsertRow } from '../connectors/common'

export interface AgentDelta {
  code: string
  type?: 'insert' | 'update' | 'delete'
  data?: Record<string, unknown>
  changes?: Record<string, { from: unknown; to: unknown }>
  // Campos de identidad (period_label/payment_date/uuid_sat…) que NO cambiaron
  // pero que upsertPayrollRecord necesita para encontrar el recibo existente —
  // un delta de "update" solo trae los campos que sí cambiaron en `changes`,
  // así que sin esto un update de, digamos, solo ISR no puede hacer match
  // contra el recibo previo y termina insertando uno nuevo en vez de
  // actualizarlo. Ver packages/agent/src/watcher.ts::splitDelta.
  context?: Record<string, unknown>
}

export interface ApplyDeltaResult {
  outcome: 'inserted' | 'updated' | 'skipped'
  employeeId?: string
  newNeto?: number | null
  previousNeto?: number | null
  diff?: number | null
}

const EMPLOYEE_DATE_FIELDS   = new Set(['hire_date'])
const EMPLOYEE_NUMERIC_FIELDS = new Set(['daily_salary', 'monthly_salary'])
const PAYROLL_DATE_FIELDS    = new Set(['period_start', 'period_end', 'payment_date'])
const PAYROLL_NUMERIC_FIELDS = new Set([
  'days_paid', 'gross_taxable', 'gross_exempt', 'total_income', 'isr',
  'imss_employee', 'infonavit', 'other_deductions', 'total_deductions', 'net_pay',
])
const ATTENDANCE_WRITABLE_COLUMNS = ['check_in_at', 'check_out_at', 'plant', 'method'] as const
const ATTENDANCE_DATE_FIELDS = new Set(['check_in_at', 'check_out_at'])

function coerceValue(field: string, value: unknown, dateFields: Set<string>, numericFields: Set<string>): unknown {
  if (value === null || value === undefined) return value
  if (dateFields.has(field)) return new Date(value as string)
  if (numericFields.has(field)) return Number(value)
  return value
}

// Un delta "insert" trae la fila completa en `data`; un "update" trae solo
// los campos que cambiaron en `changes[field].to` — en ambos casos, solo se
// copian los campos presentes en `whitelist` (mismas columnas que ya puede
// escribir el ETL de archivo completo).
function fieldsFromDelta(
  delta: AgentDelta,
  whitelist: readonly string[],
  dateFields: Set<string>,
  numericFields: Set<string>
): Record<string, unknown> {
  const source: Record<string, unknown> =
    delta.type === 'insert'
      ? (delta.data || {})
      : {
          ...(delta.context || {}),
          ...Object.fromEntries(Object.entries(delta.changes || {}).map(([k, v]) => [k, v.to])),
        }

  const out: Record<string, unknown> = {}
  for (const field of whitelist) {
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      out[field] = coerceValue(field, source[field], dateFields, numericFields)
    }
  }
  return out
}

async function findEmployeeId(tenantDb: any, tenantId: string, code: string): Promise<string | undefined> {
  const found = await tenantDb.$queryRaw<{ id: string }[]>`
    SELECT id FROM employees WHERE tenant_id = ${tenantId} AND (employee_code = ${code} OR rfc = ${code}) LIMIT 1
  `
  return found[0]?.id
}

async function applyAttendanceDelta(tenantDb: any, tenantId: string, delta: AgentDelta): Promise<ApplyDeltaResult> {
  const employeeId = await findEmployeeId(tenantDb, tenantId, delta.code)
  if (!employeeId) throw new Error(`Empleado con clave "${delta.code}" no encontrado`)

  const fields = fieldsFromDelta(delta, ATTENDANCE_WRITABLE_COLUMNS, ATTENDANCE_DATE_FIELDS, new Set())

  const existing = await tenantDb.$queryRaw<{ id: string }[]>`
    SELECT id FROM attendance_records
    WHERE tenant_id = ${tenantId} AND employee_id = ${employeeId} AND check_in_at::date = CURRENT_DATE
    LIMIT 1
  `

  if (existing[0]) {
    const setFragments = Object.entries(fields).map(([col, value]) => Prisma.sql`${Prisma.raw(col)} = ${value}`)
    if (setFragments.length === 0) return { outcome: 'skipped', employeeId }
    await tenantDb.$executeRaw`UPDATE attendance_records SET ${Prisma.join(setFragments, ', ')} WHERE id = ${existing[0].id}`
    return { outcome: 'updated', employeeId }
  }

  const checkIn = (fields.check_in_at as Date | undefined) || new Date()
  await tenantDb.$executeRaw`
    INSERT INTO attendance_records (tenant_id, employee_id, check_in_at, check_out_at, plant, method)
    VALUES (${tenantId}, ${employeeId}, ${checkIn}, ${fields.check_out_at ?? null}, ${fields.plant ?? null}, ${fields.method ?? 'AGENT'})
  `
  return { outcome: 'inserted', employeeId }
}

export async function applyDelta(
  tenantDb: any,
  tenantId: string,
  entity: 'employee' | 'payroll' | 'attendance',
  delta: AgentDelta
): Promise<ApplyDeltaResult> {
  if (entity === 'employee') {
    if (delta.type === 'delete') {
      // Una baja NO borra el registro por delta — una lectura parcial del
      // archivo del cliente (agente leyendo a medio-guardar, o un filtro mal
      // puesto) no debe poder desaparecer un empleado real. La baja formal
      // sigue el flujo de offboarding normal, fuera de este canal.
      return { outcome: 'skipped' }
    }
    const fields = fieldsFromDelta(delta, WRITABLE_EMPLOYEE_COLUMNS, EMPLOYEE_DATE_FIELDS, EMPLOYEE_NUMERIC_FIELDS) as EmployeeUpsertRow
    if (!fields.employee_code && !fields.rfc) fields.employee_code = delta.code
    const result = await upsertEmployee(tenantDb, tenantId, fields, 'agent_ws')
    return { outcome: result.outcome, employeeId: result.id }
  }

  if (entity === 'payroll') {
    const employeeId = await findEmployeeId(tenantDb, tenantId, delta.code)
    if (!employeeId) throw new Error(`Empleado con clave "${delta.code}" no encontrado`)
    const fields = fieldsFromDelta(delta, WRITABLE_PAYROLL_COLUMNS, PAYROLL_DATE_FIELDS, PAYROLL_NUMERIC_FIELDS) as PayrollUpsertRow
    const result = await upsertPayrollRecord(tenantDb, tenantId, employeeId, fields, 'agent_ws')
    return {
      outcome:      result.outcome,
      employeeId,
      newNeto:      result.newNetPay,
      previousNeto: result.previousNetPay,
      diff:         result.previousNetPay != null && result.newNetPay != null ? result.newNetPay - result.previousNetPay : null,
    }
  }

  return applyAttendanceDelta(tenantDb, tenantId, delta)
}

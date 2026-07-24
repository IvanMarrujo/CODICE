// ============================================================
// CÓDICE · Conector Factorial
// Conector "vivo" (API en cada sync, sin archivo) — token estático (API key,
// no OAuth2 — la UI del wizard solo pide un campo, igual que Runa/Worky/Buk)
// + mapeo FIJO. `department` no viene con nombre directo en el empleado
// (solo `team_ids`) — se resuelve con una llamada extra a /teams y un mapa
// id -> nombre, igual criterio que Zoho resolviendo Reporting_To por texto.
// Factorial no manda email en el listado de empleados (spec de CÓDICE), así
// que ese campo queda sin mapear a propósito.
// ============================================================

import { redis } from '../../lib/redis'
import { EmployeeUpsertRow } from '../common'

export interface FactorialCredentials {
  token: string
}

function credentialsKey(tenantId: string): string {
  return `t:${tenantId}:factorial:token`
}

export async function getFactorialCredentials(tenantId: string): Promise<FactorialCredentials | null> {
  const raw = await redis.get(credentialsKey(tenantId))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return (parsed && typeof parsed === 'object') ? parsed : null
  } catch {
    return null
  }
}

export async function saveFactorialCredentials(tenantId: string, creds: FactorialCredentials): Promise<void> {
  await redis.set(credentialsKey(tenantId), JSON.stringify(creds))
}

export async function deleteFactorialCredentials(tenantId: string): Promise<void> {
  await redis.del(credentialsKey(tenantId))
}

// ── Factorial API ─────────────────────────────────────────────

const FACTORIAL_API_URL = 'https://api.factorialhr.com/api/v1'
const PAGE_SIZE = 100

/**
 * Pagina GET /employees completo. Factorial no documenta un total de
 * páginas — se sigue pidiendo hasta que una página regrese menos de
 * PAGE_SIZE registros (fin de paginación), mismo criterio usado por el
 * conector Worky/Buk.
 */
export async function fetchAllFactorialEmployees(creds: FactorialCredentials): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = []
  let page = 1

  while (true) {
    const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) })
    const res = await fetch(`${FACTORIAL_API_URL}/employees?${params.toString()}`, {
      headers: { Authorization: `Bearer ${creds.token}` },
    })
    const body: any = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(body?.message || `Factorial API error (${res.status})`)
    }

    const pageRecords: Record<string, unknown>[] = body?.data || []
    all.push(...pageRecords)

    if (pageRecords.length < PAGE_SIZE) break
    page++
  }

  return all
}

/** Trae /teams una sola vez por sync y arma un mapa id -> nombre para resolver team_ids[0]. */
export async function fetchFactorialTeamNames(creds: FactorialCredentials): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const res = await fetch(`${FACTORIAL_API_URL}/teams`, {
    headers: { Authorization: `Bearer ${creds.token}` },
  })
  const body: any = await res.json().catch(() => ({}))
  if (!res.ok) return map

  for (const team of (body?.data || [])) {
    if (team?.id != null && team?.name != null) map.set(String(team.id), String(team.name))
  }
  return map
}

// ── Mapeo de campos Factorial -> CÓDICE ───────────────────────

function str(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  return s === '' ? undefined : s
}

function parseDate(raw: unknown): Date | undefined {
  if (raw == null || raw === '') return undefined
  const d = new Date(String(raw))
  return isNaN(d.getTime()) ? undefined : d
}

// Única fuente de verdad para el mapeo Factorial -> CÓDICE — usada tanto por
// mapFactorialRecordToEmployee (abajo) como por el endpoint /preview
// (routes/factorial.ts). `status` y `department` son campos DERIVADOS
// (terminated_on / team_ids[0] resuelto vía teamNames), no un campo 1:1 del
// registro crudo — se listan igual para que el wizard muestre columnas
// consistentes con el resto de los conectores fijos.
export const FACTORIAL_FIELD_MAP: { factorialField: string; label: string; canonicalField: keyof EmployeeUpsertRow }[] = [
  { factorialField: 'id',             label: 'ID de empleado (Factorial)', canonicalField: 'employee_code' },
  { factorialField: 'first_name',     label: 'Nombre',                     canonicalField: 'first_name' },
  { factorialField: 'last_name',      label: 'Apellido',                   canonicalField: 'last_name' },
  { factorialField: 'phone_number',   label: 'Teléfono',                    canonicalField: 'phone' },
  { factorialField: 'team_ids[0]',    label: 'Departamento',               canonicalField: 'department' },
  { factorialField: 'role',           label: 'Puesto',                     canonicalField: 'position' },
  { factorialField: 'hired_on',       label: 'Fecha de ingreso',           canonicalField: 'hire_date' },
  { factorialField: 'terminated_on',  label: 'Estatus',                    canonicalField: 'status' },
  { factorialField: 'location_id',    label: 'Planta / Ubicación',         canonicalField: 'plant' },
]

/** Convierte un registro crudo de Factorial a la fila canónica de upsertEmployee. */
export function mapFactorialRecordToEmployee(raw: Record<string, unknown>, teamNames: Map<string, string>): EmployeeUpsertRow {
  const teamIds = raw['team_ids']
  const firstTeamId = Array.isArray(teamIds) && teamIds.length > 0 ? String(teamIds[0]) : undefined

  return {
    employee_code: str(raw['id']),
    first_name:    str(raw['first_name']),
    last_name:     str(raw['last_name']),
    phone:         str(raw['phone_number']),
    department:    firstTeamId ? (teamNames.get(firstTeamId) || firstTeamId) : undefined,
    position:      str(raw['role']),
    hire_date:     parseDate(raw['hired_on']),
    status:        raw['terminated_on'] ? 'Baja' : 'Activo',
    plant:         str(raw['location_id']),
  }
}

/** Prueba la conexión: token válido + primera página completa (empleados reales, no solo 1). */
export async function testFactorialConnection(creds: FactorialCredentials): Promise<{ employeeCount: number; sample: EmployeeUpsertRow[] }> {
  const [records, teamNames] = await Promise.all([
    fetchAllFactorialEmployees(creds),
    fetchFactorialTeamNames(creds),
  ])
  const mapped = records.map((r) => mapFactorialRecordToEmployee(r, teamNames))
  return { employeeCount: mapped.length, sample: mapped.slice(0, 3) }
}

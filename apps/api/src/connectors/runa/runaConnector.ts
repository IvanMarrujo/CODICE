// ============================================================
// CÓDICE · Conector Runa HR
// Conector "vivo" (API en cada sync, sin archivo) — token estático (sin
// refresh, a diferencia de Zoho) + mapeo FIJO (a diferencia de Monday, cuyas
// columnas son de forma libre). Mismo patrón que zohoConnector.ts pero sin
// OAuth2. CÓDICE se conecta a Runa sin reemplazarlo.
// ============================================================

import { redis } from '../../lib/redis'
import { EmployeeUpsertRow } from '../common'

export interface RunaCredentials {
  token: string
}

function credentialsKey(tenantId: string): string {
  return `t:${tenantId}:runa:token`
}

export async function getRunaCredentials(tenantId: string): Promise<RunaCredentials | null> {
  const raw = await redis.get(credentialsKey(tenantId))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return (parsed && typeof parsed === 'object') ? parsed : null
  } catch {
    return null
  }
}

export async function saveRunaCredentials(tenantId: string, creds: RunaCredentials): Promise<void> {
  await redis.set(credentialsKey(tenantId), JSON.stringify(creds))
}

export async function deleteRunaCredentials(tenantId: string): Promise<void> {
  await redis.del(credentialsKey(tenantId))
}

// ── Runa HR API ───────────────────────────────────────────────

const RUNA_API_URL = 'https://api.runa.io/v1'
const PAGE_SIZE = 100

/** Pagina GET /employees completo usando meta.total_pages. */
export async function fetchAllRunaEmployees(creds: RunaCredentials): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = []
  let page = 1
  let totalPages = 1

  do {
    const params = new URLSearchParams({ page: String(page), per_page: String(PAGE_SIZE) })
    const res = await fetch(`${RUNA_API_URL}/employees?${params.toString()}`, {
      headers: { Authorization: `Bearer ${creds.token}` },
    })
    const body: any = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(body?.message || `Runa HR API error (${res.status})`)
    }

    all.push(...(body?.data || []))
    totalPages = Number(body?.meta?.total_pages) || 1
    page++
  } while (page <= totalPages)

  return all
}

// ── Mapeo de campos Runa -> CÓDICE ────────────────────────────

const RUNA_STATUS_MAP: Record<string, string> = {
  active:   'Activo',
  inactive: 'Baja',
}

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

// Única fuente de verdad para el mapeo Runa -> CÓDICE — usada tanto por
// mapRunaRecordToEmployee (abajo) como por el endpoint /preview
// (routes/runa.ts), que arma los "headers" del wizard a partir de esta
// misma lista, así ambos nunca se desalinean.
export const RUNA_FIELD_MAP: { runaField: string; label: string; canonicalField: keyof EmployeeUpsertRow }[] = [
  { runaField: 'id',            label: 'ID de empleado (Runa)', canonicalField: 'employee_code' },
  { runaField: 'first_name',    label: 'Nombre',                canonicalField: 'first_name' },
  { runaField: 'last_name',     label: 'Apellido',              canonicalField: 'last_name' },
  { runaField: 'email',         label: 'Correo electrónico',    canonicalField: 'email' },
  { runaField: 'phone',         label: 'Teléfono',               canonicalField: 'phone' },
  { runaField: 'department',    label: 'Departamento',          canonicalField: 'department' },
  { runaField: 'job_title',     label: 'Puesto',                canonicalField: 'position' },
  { runaField: 'hire_date',     label: 'Fecha de ingreso',      canonicalField: 'hire_date' },
  { runaField: 'status',        label: 'Estatus',               canonicalField: 'status' },
  { runaField: 'location',      label: 'Planta / Ubicación',    canonicalField: 'plant' },
  { runaField: 'manager_name',  label: 'Supervisor',            canonicalField: 'supervisor_name' },
]

/** Convierte un registro crudo de Runa a la fila canónica de upsertEmployee. */
export function mapRunaRecordToEmployee(raw: Record<string, unknown>): EmployeeUpsertRow {
  const runaStatus = str(raw['status'])
  return {
    employee_code:   str(raw['id']),
    first_name:      str(raw['first_name']),
    last_name:       str(raw['last_name']),
    email:           str(raw['email']),
    phone:           str(raw['phone']),
    department:      str(raw['department']),
    position:        str(raw['job_title']),
    hire_date:       parseDate(raw['hire_date']),
    status:          runaStatus ? (RUNA_STATUS_MAP[runaStatus.toLowerCase()] || runaStatus) : undefined,
    plant:           str(raw['location']),
    supervisor_name: str(raw['manager_name']),
  }
}

/** Prueba la conexión: token válido + primera página completa (empleados reales, no solo 1). */
export async function testRunaConnection(creds: RunaCredentials): Promise<{ employeeCount: number; sample: EmployeeUpsertRow[] }> {
  const records = await fetchAllRunaEmployees(creds)
  const mapped = records.map(mapRunaRecordToEmployee)
  return { employeeCount: mapped.length, sample: mapped.slice(0, 3) }
}

// ============================================================
// CÓDICE · Conector Worky
// Conector "vivo" (API en cada sync, sin archivo) — token estático + mapeo
// FIJO, mismo patrón que runaConnector.ts. Worky manda el nombre completo en
// un solo campo ("name"), no first/last separados — se divide con
// splitFullName, igual que el conector Monday con la columna "Nombre".
// ============================================================

import { redis } from '../../lib/redis'
import { EmployeeUpsertRow } from '../common'
import { splitFullName } from '../excel/excelParser'

export interface WorkyCredentials {
  token: string
}

function credentialsKey(tenantId: string): string {
  return `t:${tenantId}:worky:token`
}

export async function getWorkyCredentials(tenantId: string): Promise<WorkyCredentials | null> {
  const raw = await redis.get(credentialsKey(tenantId))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return (parsed && typeof parsed === 'object') ? parsed : null
  } catch {
    return null
  }
}

export async function saveWorkyCredentials(tenantId: string, creds: WorkyCredentials): Promise<void> {
  await redis.set(credentialsKey(tenantId), JSON.stringify(creds))
}

export async function deleteWorkyCredentials(tenantId: string): Promise<void> {
  await redis.del(credentialsKey(tenantId))
}

// ── Worky API ─────────────────────────────────────────────────

const WORKY_API_URL = 'https://api.worky.mx/v2'
const PAGE_SIZE = 100

/**
 * Pagina GET /collaborators completo. Worky no documenta un total de
 * páginas — se sigue pidiendo hasta que una página regrese menos de
 * PAGE_SIZE registros (fin de paginación), mismo criterio usado por el
 * conector Monday para items_page.
 */
export async function fetchAllWorkyCollaborators(creds: WorkyCredentials): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = []
  let page = 1

  while (true) {
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) })
    const res = await fetch(`${WORKY_API_URL}/collaborators?${params.toString()}`, {
      headers: { Authorization: `Bearer ${creds.token}` },
    })
    const body: any = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(body?.message || `Worky API error (${res.status})`)
    }

    const pageRecords: Record<string, unknown>[] = body?.data || []
    all.push(...pageRecords)

    if (pageRecords.length < PAGE_SIZE) break
    page++
  }

  return all
}

// ── Mapeo de campos Worky -> CÓDICE ───────────────────────────

const WORKY_STATUS_MAP: Record<string, string> = {
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

// Única fuente de verdad para el mapeo Worky -> CÓDICE — usada tanto por
// mapWorkyRecordToEmployee (abajo) como por el endpoint /preview
// (routes/worky.ts). 'full_name' no es un campo real de EmployeeUpsertRow
// (se resuelve con splitFullName antes de armar la fila), igual que Monday.
type WorkyTargetField = keyof EmployeeUpsertRow | 'full_name'

export const WORKY_FIELD_MAP: { workyField: string; label: string; canonicalField: WorkyTargetField }[] = [
  { workyField: 'collaborator_id', label: 'ID de colaborador (Worky)', canonicalField: 'employee_code' },
  { workyField: 'name',            label: 'Nombre completo',          canonicalField: 'full_name' },
  { workyField: 'email',           label: 'Correo electrónico',       canonicalField: 'email' },
  { workyField: 'phone',           label: 'Teléfono',                  canonicalField: 'phone' },
  { workyField: 'department_name', label: 'Departamento',             canonicalField: 'department' },
  { workyField: 'position_name',   label: 'Puesto',                   canonicalField: 'position' },
  { workyField: 'start_date',      label: 'Fecha de ingreso',         canonicalField: 'hire_date' },
  { workyField: 'status',          label: 'Estatus',                  canonicalField: 'status' },
  { workyField: 'branch_name',     label: 'Planta / Sucursal',        canonicalField: 'plant' },
  { workyField: 'direct_manager',  label: 'Supervisor',               canonicalField: 'supervisor_name' },
]

/** Convierte un registro crudo de Worky a la fila canónica de upsertEmployee. */
export function mapWorkyRecordToEmployee(raw: Record<string, unknown>): EmployeeUpsertRow & { full_name?: string } {
  const workyStatus = str(raw['status'])
  const out: EmployeeUpsertRow & { full_name?: string } = {
    employee_code:   str(raw['collaborator_id']),
    email:           str(raw['email']),
    phone:           str(raw['phone']),
    department:      str(raw['department_name']),
    position:        str(raw['position_name']),
    hire_date:       parseDate(raw['start_date']),
    status:          workyStatus ? (WORKY_STATUS_MAP[workyStatus.toLowerCase()] || workyStatus) : undefined,
    plant:           str(raw['branch_name']),
    supervisor_name: str(raw['direct_manager']),
  }

  const fullName = str(raw['name'])
  if (fullName) {
    const { first_name, last_name } = splitFullName(fullName)
    out.first_name = first_name
    out.last_name  = last_name
    out.full_name   = fullName
  }

  return out
}

/** Prueba la conexión: token válido + primera página completa (colaboradores reales, no solo 1). */
export async function testWorkyConnection(creds: WorkyCredentials): Promise<{ employeeCount: number; sample: EmployeeUpsertRow[] }> {
  const records = await fetchAllWorkyCollaborators(creds)
  const mapped = records.map(mapWorkyRecordToEmployee)
  return { employeeCount: mapped.length, sample: mapped.slice(0, 3) }
}

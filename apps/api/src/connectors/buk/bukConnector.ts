// ============================================================
// CÓDICE · Conector Buk
// Conector "vivo" (API en cada sync, sin archivo) — API key en header
// X-Api-Key (no Bearer) + mapeo FIJO, mismo patrón que runaConnector.ts.
// Buk opera con dominios separados por país (.cl / .com.mx) — `country`
// resuelve la base URL, igual que `dataCenter` en el conector Zoho.
// ============================================================

import { redis } from '../../lib/redis'
import { EmployeeUpsertRow } from '../common'

export type BukCountry = 'cl' | 'mx'

export interface BukCredentials {
  apiKey:  string
  country: BukCountry
}

function credentialsKey(tenantId: string): string {
  return `t:${tenantId}:buk:apiKey`
}

export async function getBukCredentials(tenantId: string): Promise<BukCredentials | null> {
  const raw = await redis.get(credentialsKey(tenantId))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return (parsed && typeof parsed === 'object') ? parsed : null
  } catch {
    return null
  }
}

export async function saveBukCredentials(tenantId: string, creds: BukCredentials): Promise<void> {
  await redis.set(credentialsKey(tenantId), JSON.stringify(creds))
}

export async function deleteBukCredentials(tenantId: string): Promise<void> {
  await redis.del(credentialsKey(tenantId))
}

// ── Buk API ───────────────────────────────────────────────────

function bukBaseUrl(country: BukCountry): string {
  return country === 'cl' ? 'https://app.buk.cl/api/v1' : 'https://app.buk.com.mx/api/v1'
}

const PAGE_SIZE = 100

/**
 * Pagina GET /employees completo. Buk no documenta un total de páginas —
 * se sigue pidiendo hasta que una página regrese menos de PAGE_SIZE
 * registros (fin de paginación), mismo criterio usado por el conector Worky.
 */
export async function fetchAllBukEmployees(creds: BukCredentials): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = []
  let page = 1
  const baseUrl = bukBaseUrl(creds.country)

  while (true) {
    const params = new URLSearchParams({ page: String(page), per_page: String(PAGE_SIZE) })
    const res = await fetch(`${baseUrl}/employees?${params.toString()}`, {
      headers: { 'X-Api-Key': creds.apiKey },
    })
    const body: any = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(body?.message || `Buk API error (${res.status})`)
    }

    const pageRecords: Record<string, unknown>[] = body?.data || []
    all.push(...pageRecords)

    if (pageRecords.length < PAGE_SIZE) break
    page++
  }

  return all
}

// ── Mapeo de campos Buk -> CÓDICE ─────────────────────────────

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

// Única fuente de verdad para el mapeo Buk -> CÓDICE — usada tanto por
// mapBukRecordToEmployee (abajo) como por el endpoint /preview
// (routes/buk.ts).
export const BUK_FIELD_MAP: { bukField: string; label: string; canonicalField: keyof EmployeeUpsertRow }[] = [
  { bukField: 'id',           label: 'ID de empleado (Buk)',   canonicalField: 'employee_code' },
  { bukField: 'first_name',   label: 'Nombre',                 canonicalField: 'first_name' },
  { bukField: 'last_name',    label: 'Apellido',               canonicalField: 'last_name' },
  { bukField: 'email',        label: 'Correo electrónico',     canonicalField: 'email' },
  { bukField: 'phone',        label: 'Teléfono',                canonicalField: 'phone' },
  { bukField: 'cost_center',  label: 'Centro de costo',        canonicalField: 'department' },
  { bukField: 'position',     label: 'Puesto',                 canonicalField: 'position' },
  { bukField: 'start_date',   label: 'Fecha de ingreso',       canonicalField: 'hire_date' },
  { bukField: 'active',       label: 'Estatus',                canonicalField: 'status' },
  { bukField: 'location',     label: 'Planta / Ubicación',     canonicalField: 'plant' },
]

/** Convierte un registro crudo de Buk a la fila canónica de upsertEmployee. */
export function mapBukRecordToEmployee(raw: Record<string, unknown>): EmployeeUpsertRow {
  return {
    employee_code: str(raw['id']),
    first_name:    str(raw['first_name']),
    last_name:     str(raw['last_name']),
    email:         str(raw['email']),
    phone:         str(raw['phone']),
    department:    str(raw['cost_center']),
    position:      str(raw['position']),
    hire_date:     parseDate(raw['start_date']),
    status:        raw['active'] === false ? 'Baja' : (raw['active'] === true ? 'Activo' : undefined),
    plant:         str(raw['location']),
  }
}

/** Prueba la conexión: API key válida + primera página completa (empleados reales, no solo 1). */
export async function testBukConnection(creds: BukCredentials): Promise<{ employeeCount: number; sample: EmployeeUpsertRow[] }> {
  const records = await fetchAllBukEmployees(creds)
  const mapped = records.map(mapBukRecordToEmployee)
  return { employeeCount: mapped.length, sample: mapped.slice(0, 3) }
}

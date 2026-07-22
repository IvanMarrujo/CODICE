// ============================================================
// CÓDICE · Conector Zoho People
// A diferencia de Excel/CFDI/DBF (archivo que el usuario sube), Zoho es un
// conector "vivo": llama la API de Zoho People directamente en cada sync,
// con credenciales OAuth2 guardadas por tenant en Redis (nunca en DB).
// ============================================================

import { redis } from '../../lib/redis'
import { EmployeeUpsertRow } from '../common'

export type ZohoDataCenter = 'com' | 'eu' | 'in'

export interface ZohoCredentials {
  clientId:     string
  clientSecret: string
  refreshToken: string
  dataCenter:   ZohoDataCenter
  accessToken?: string
  expiresAt?:   number // epoch ms
}

export interface ZohoSyncRowError {
  employeeId?: string
  message:     string
}

export interface ZohoSyncChange {
  employeeId: string
  outcome:    'inserted' | 'updated'
}

export interface ZohoSyncResult {
  processed: number
  inserted:  number
  updated:   number
  errors:    ZohoSyncRowError[]
  changes:   ZohoSyncChange[]
}

function credentialsKey(tenantId: string): string {
  return `t:${tenantId}:zoho:credentials`
}

export async function getZohoCredentials(tenantId: string): Promise<ZohoCredentials | null> {
  const raw = await redis.get(credentialsKey(tenantId))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return (parsed && typeof parsed === 'object') ? parsed : null
  } catch {
    return null
  }
}

export async function saveZohoCredentials(tenantId: string, creds: ZohoCredentials): Promise<void> {
  await redis.set(credentialsKey(tenantId), JSON.stringify(creds))
}

export async function deleteZohoCredentials(tenantId: string): Promise<void> {
  await redis.del(credentialsKey(tenantId))
}

// ── OAuth2 (refresh token -> access token) ───────────────────

// Buffer de 60s antes del vencimiento real — evita que un access_token
// expire A MITAD de una paginación larga (getRecords puede tardar varios
// segundos por página en orgs grandes).
const TOKEN_EXPIRY_BUFFER_MS = 60_000

async function requestAccessToken(creds: ZohoCredentials): Promise<{ accessToken: string; expiresAt: number }> {
  const url = `https://accounts.zoho.${creds.dataCenter}/oauth/v2/token`
  const params = new URLSearchParams({
    grant_type:    'refresh_token',
    client_id:     creds.clientId,
    client_secret: creds.clientSecret,
    refresh_token: creds.refreshToken,
  })

  const res = await fetch(`${url}?${params.toString()}`, { method: 'POST' })
  const body: any = await res.json().catch(() => ({}))
  if (!res.ok || !body.access_token) {
    throw new Error(body.error || `No se pudo renovar el token de Zoho (${res.status})`)
  }

  return {
    accessToken: body.access_token,
    expiresAt:   Date.now() + (Number(body.expires_in || 3600) * 1000) - TOKEN_EXPIRY_BUFFER_MS,
  }
}

/** Devuelve un access_token vigente — lo renueva (y persiste en Redis) si ya expiró o está por expirar. */
export async function ensureAccessToken(tenantId: string, creds: ZohoCredentials): Promise<string> {
  if (creds.accessToken && creds.expiresAt && creds.expiresAt > Date.now()) {
    return creds.accessToken
  }
  const { accessToken, expiresAt } = await requestAccessToken(creds)
  const updated: ZohoCredentials = { ...creds, accessToken, expiresAt }
  await saveZohoCredentials(tenantId, updated)
  return accessToken
}

// ── Zoho People API ──────────────────────────────────────────

const PAGE_SIZE = 200

/**
 * Pagina /forms/employee/getRecords completo. Zoho responde
 * `{ response: { result: [ { "<sIndex>": [ {...registro...} ] }, ... ] } }`
 * (un objeto por página interna, cada uno con UN solo registro adentro) —
 * se aplana a una lista simple. Cuando ya no hay más registros, Zoho
 * regresa `response.errors` con el código 7204 ("No Records Found") en vez
 * de un array vacío — se trata igual como "fin de paginación", no como error.
 */
export async function fetchAllZohoEmployees(tenantId: string, creds: ZohoCredentials): Promise<Record<string, unknown>[]> {
  const accessToken = await ensureAccessToken(tenantId, creds)
  const baseUrl = `https://people.zoho.${creds.dataCenter}/people/api/forms/employee/getRecords`

  const all: Record<string, unknown>[] = []
  let sIndex = 1

  while (true) {
    const params = new URLSearchParams({ sIndex: String(sIndex), limit: String(PAGE_SIZE) })
    const res = await fetch(`${baseUrl}?${params.toString()}`, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    })
    const body: any = await res.json().catch(() => ({}))

    if (!res.ok) {
      throw new Error(body?.response?.errors?.message || `Zoho People API error (${res.status})`)
    }

    const result = body?.response?.result
    if (!result || (Array.isArray(result) && result.length === 0)) break

    const pageRecords = (Array.isArray(result)
      ? result.flatMap((entry: Record<string, unknown[]>) => Object.values(entry).flat())
      : Object.values(result).flat()) as Record<string, unknown>[]

    if (pageRecords.length === 0) break
    all.push(...pageRecords)

    if (pageRecords.length < PAGE_SIZE) break // última página
    sIndex += PAGE_SIZE
  }

  return all
}

// ── Mapeo de campos Zoho -> CÓDICE ────────────────────────────

const ZOHO_STATUS_MAP: Record<string, string> = {
  Active:   'Activo',
  Inactive: 'Baja',
}

/** Zoho manda fechas como "dd-MMM-yyyy" (ej. "15-Jan-2020"). */
function parseZohoDate(raw: unknown): Date | undefined {
  if (raw == null || raw === '') return undefined
  const str = String(raw).trim()
  const match = str.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/)
  if (match) {
    const [, dd, mon, yyyy] = match
    const months: Record<string, number> = {
      Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
      Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
    }
    const monthIndex = months[mon]
    if (monthIndex !== undefined) {
      const d = new Date(Number(yyyy), monthIndex, Number(dd))
      return isNaN(d.getTime()) ? undefined : d
    }
  }
  const d = new Date(str)
  return isNaN(d.getTime()) ? undefined : d
}

function str(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  return s === '' ? undefined : s
}

// Única fuente de verdad para el mapeo Zoho -> CÓDICE — usada tanto por
// mapZohoRecordToEmployee (abajo) como por el endpoint /preview
// (routes/zoho.ts), que arma los "headers" del wizard a partir de esta
// misma lista, así ambos nunca se desalinean.
export const ZOHO_FIELD_MAP: { zohoField: string; label: string; canonicalField: keyof EmployeeUpsertRow }[] = [
  { zohoField: 'Employee_ID',      label: 'ID de empleado (Zoho)', canonicalField: 'employee_code' },
  { zohoField: 'First_Name',       label: 'Nombre',                canonicalField: 'first_name' },
  { zohoField: 'Last_Name',        label: 'Apellido',              canonicalField: 'last_name' },
  { zohoField: 'Email',            label: 'Correo electrónico',    canonicalField: 'email' },
  { zohoField: 'Mobile',           label: 'Teléfono',               canonicalField: 'phone' },
  { zohoField: 'Department',       label: 'Departamento',          canonicalField: 'department' },
  { zohoField: 'Designation',      label: 'Puesto',                canonicalField: 'position' },
  { zohoField: 'Date_of_Joining',  label: 'Fecha de ingreso',      canonicalField: 'hire_date' },
  { zohoField: 'Employee_Status',  label: 'Estatus',               canonicalField: 'status' },
  { zohoField: 'Reporting_To',     label: 'Supervisor',            canonicalField: 'supervisor_name' },
  { zohoField: 'Work_Location',    label: 'Planta / Ubicación',    canonicalField: 'plant' },
]

/** Convierte un registro crudo de Zoho People a la fila canónica de upsertEmployee. */
export function mapZohoRecordToEmployee(raw: Record<string, unknown>): EmployeeUpsertRow {
  const zohoStatus = str(raw['Employee_Status'])
  return {
    employee_code:   str(raw['Employee_ID']),
    first_name:      str(raw['First_Name']),
    last_name:       str(raw['Last_Name']),
    email:           str(raw['Email']),
    phone:           str(raw['Mobile']),
    department:      str(raw['Department']),
    position:        str(raw['Designation']),
    hire_date:       parseZohoDate(raw['Date_of_Joining']),
    status:          zohoStatus ? (ZOHO_STATUS_MAP[zohoStatus] || zohoStatus) : undefined,
    supervisor_name: str(raw['Reporting_To']),
    plant:           str(raw['Work_Location']),
  }
}

/** Prueba la conexión: token válido + primera página completa (empleados reales, no solo 1). */
export async function testZohoConnection(tenantId: string, creds: ZohoCredentials): Promise<{ employeeCount: number; sample: EmployeeUpsertRow[] }> {
  const records = await fetchAllZohoEmployees(tenantId, creds)
  const mapped = records.map(mapZohoRecordToEmployee)
  return { employeeCount: mapped.length, sample: mapped.slice(0, 3) }
}

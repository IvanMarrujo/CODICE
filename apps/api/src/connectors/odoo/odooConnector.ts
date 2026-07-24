// ============================================================
// CÓDICE · Conector Odoo (hr.employee)
// Conector "vivo" (JSON-RPC en cada sync, sin archivo) — mismo modelo que
// Zoho/Monday: credenciales por tenant en Redis, nunca en Postgres. A
// diferencia de esos dos, Odoo usa usuario+contraseña (no OAuth2/token
// estático) — la contraseña se cifra con AES-256-GCM antes de guardarse
// (ver ENCRYPTION_KEY, derivada de WEBHOOK_SECRET) en vez de guardarse en claro.
// ============================================================

import * as crypto from 'crypto'
import { redis } from '../../lib/redis'
import { WEBHOOK_SECRET } from '../../routes/webhook'
import { EmployeeUpsertRow } from '../common'
import { splitFullName } from '../excel/excelParser'

export interface OdooCredentials {
  url:      string
  database: string
  username: string
  password: string // cifrado (AES-256-GCM) — ver encryptPassword/decryptPassword
  uid:      number
}

// ── Password en reposo: AES-256-GCM con clave derivada de WEBHOOK_SECRET ──
// (mismo secreto que ya firma el HMAC del agente/webhook, ver routes/webhook.ts
// — no se introduce un secreto nuevo que gestionar). sha256(WEBHOOK_SECRET)
// da los 32 bytes exactos que pide AES-256; el IV va concatenado al inicio
// del texto cifrado (formato estándar iv:tag:ciphertext, todo en hex).

const ENCRYPTION_KEY = crypto.createHash('sha256').update(WEBHOOK_SECRET).digest()

export function encryptPassword(plain: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decryptPassword(stored: string): string {
  const [ivHex, tagHex, dataHex] = stored.split(':')
  if (!ivHex || !tagHex || !dataHex) throw new Error('Credencial de Odoo corrupta — reconecta')
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8')
}

function credentialsKey(tenantId: string): string {
  return `t:${tenantId}:odoo:credentials`
}

export async function getOdooCredentials(tenantId: string): Promise<OdooCredentials | null> {
  const raw = await redis.get(credentialsKey(tenantId))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return (parsed && typeof parsed === 'object') ? parsed : null
  } catch {
    return null
  }
}

export async function saveOdooCredentials(tenantId: string, creds: OdooCredentials): Promise<void> {
  await redis.set(credentialsKey(tenantId), JSON.stringify(creds))
}

export async function deleteOdooCredentials(tenantId: string): Promise<void> {
  await redis.del(credentialsKey(tenantId))
}

// ── JSON-RPC sobre HTTPS ──────────────────────────────────────
// NOTA vs. el spec original: el spec describía llamar
// `/web/dataset/call_kw` con `{model, method, args, kwargs}` sin uid/
// password en las llamadas de datos — ese endpoint es el que usa la sesión
// del NAVEGADOR (cookie), no sirve para integraciones externas sin sesión.
// La API externa real y documentada de Odoo (la que sí funciona contra un
// servidor real sin login previo) es JSON-RPC a `/jsonrpc` con
// `service: 'common'` (authenticate/version) y `service: 'object'` +
// `method: 'execute_kw'` para todo lo demás — reenviando db/uid/password en
// CADA llamada (es stateless, no hay sesión que reutilizar). Se implementa
// así — coincide además con el "Base URL: {odooUrl}/jsonrpc" que el spec sí
// especificaba explícitamente.

async function odooRpc(url: string, service: string, method: string, args: unknown[]): Promise<any> {
  const endpoint = `${url.replace(/\/+$/, '')}/jsonrpc`
  const res = await fetch(endpoint, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method:  'call',
      params:  { service, method, args },
      id:      Math.floor(Math.random() * 1e9),
    }),
  })
  const body: any = await res.json().catch(() => ({}))
  if (!res.ok || body.error) {
    throw new Error(body.error?.data?.message || body.error?.message || `Odoo API error (${res.status})`)
  }
  return body.result
}

/** `res.users.authenticate` — regresa el uid o lanza si las credenciales son inválidas. */
export async function authenticateOdoo(url: string, database: string, username: string, password: string): Promise<number> {
  const uid = await odooRpc(url, 'common', 'authenticate', [database, username, password, {}])
  if (!uid) throw new Error('Credenciales inválidas')
  return uid
}

export async function fetchOdooVersion(url: string): Promise<string | null> {
  try {
    const result = await odooRpc(url, 'common', 'version', [])
    return result?.server_version || null
  } catch {
    return null // informativo — si falla, el resto de la conexión sigue funcionando
  }
}

/** `object.execute_kw` — reenvía db/uid/password en cada llamada (stateless, ver nota arriba). */
async function odooExecuteKw(creds: OdooCredentials, model: string, method: string, args: unknown[], kwargs: Record<string, unknown> = {}): Promise<any> {
  const password = decryptPassword(creds.password)
  return odooRpc(creds.url, 'object', 'execute_kw', [creds.database, creds.uid, password, model, method, args, kwargs])
}

// 'id' no está en el spec original pero se agrega como fallback de
// employee_code — 'barcode' (gafete) es opcional en Odoo, muchas empresas
// nunca lo configuran, y sin identificador estable upsertEmployee OMITE la
// fila entera ("sin RFC ni employee_code" — ver connectors.ts). El id
// interno de Odoo siempre existe, igual que Employee_ID en Zoho o el id de
// item en Monday.
const EMPLOYEE_FIELDS = [
  'id', 'name', 'work_email', 'mobile_phone', 'department_id',
  'job_id', 'work_location_id', 'parent_id',
  'date_start', 'active', 'barcode',
]

const PAGE_SIZE = 200

/** Pagina hr.employee (activos) completo — offset-based, hasta que una página venga incompleta. */
export async function fetchAllOdooEmployees(creds: OdooCredentials): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = []
  let offset = 0

  while (true) {
    const page: Record<string, unknown>[] = await odooExecuteKw(
      creds, 'hr.employee', 'search_read',
      [[['active', '=', true]]],
      { fields: EMPLOYEE_FIELDS, limit: PAGE_SIZE, offset },
    )

    if (!page || page.length === 0) break
    all.push(...page)
    if (page.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  return all
}

// ── Mapeo de campos Odoo -> CÓDICE ────────────────────────────
// Fijo (como Zoho, no "smart matching" por título como Monday) — usado por
// el endpoint /preview (routes/odoo.ts) para armar los "headers" del wizard.

export const ODOO_FIELD_MAP: { label: string; canonicalField: keyof EmployeeUpsertRow | 'full_name' }[] = [
  { label: 'Clave de empleado (barcode/id de Odoo)', canonicalField: 'employee_code' },
  { label: 'Nombre completo',                         canonicalField: 'full_name' },
  { label: 'Correo electrónico',                       canonicalField: 'email' },
  { label: 'Teléfono',                                  canonicalField: 'phone' },
  { label: 'Departamento',                              canonicalField: 'department' },
  { label: 'Puesto',                                    canonicalField: 'position' },
  { label: 'Planta / Ubicación',                        canonicalField: 'plant' },
  { label: 'Supervisor',                                canonicalField: 'supervisor_name' },
  { label: 'Fecha de ingreso',                          canonicalField: 'hire_date' },
  { label: 'Estatus',                                   canonicalField: 'status' },
]

/** Campos many2one de Odoo llegan como tupla [id, "Nombre"] o `false` si no están asignados. */
function tupleName(v: unknown): string | undefined {
  if (Array.isArray(v) && v.length === 2 && typeof v[1] === 'string') return v[1].trim() || undefined
  return undefined
}

function str(v: unknown): string | undefined {
  if (v == null || v === false) return undefined
  const s = String(v).trim()
  return s === '' ? undefined : s
}

/** Convierte un registro de hr.employee a la fila canónica de upsertEmployee. */
export function mapOdooRecordToEmployee(raw: Record<string, unknown>): EmployeeUpsertRow & { full_name?: string } {
  const out: EmployeeUpsertRow & { full_name?: string } = {}

  const fullName = str(raw['name'])
  if (fullName) {
    const { first_name, last_name } = splitFullName(fullName)
    out.first_name = first_name
    out.last_name  = last_name
    out.full_name  = fullName
  }

  out.email           = str(raw['work_email'])
  out.phone            = str(raw['mobile_phone'])
  out.department       = tupleName(raw['department_id'])
  out.position         = tupleName(raw['job_id'])
  out.plant            = tupleName(raw['work_location_id'])
  out.supervisor_name  = tupleName(raw['parent_id'])
  out.employee_code    = str(raw['barcode']) || (raw['id'] != null ? String(raw['id']) : undefined)
  out.status           = raw['active'] === false ? 'Baja' : 'Activo'

  const dateStart = str(raw['date_start'])
  if (dateStart) {
    const d = new Date(dateStart)
    if (!isNaN(d.getTime())) out.hire_date = d
  }

  return out
}

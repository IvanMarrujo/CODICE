// ============================================================
// CÓDICE · Conector Monday.com
// Conector "vivo" (API en cada sync, sin archivo) — a diferencia de Zoho
// (OAuth2 + campos fijos), Monday usa un token de API estático (sin
// refresh) y los boards son de forma libre: sus columnas varían por
// tenant, así que el mapeo es "smart matching" por título de columna
// (case-insensitive) en vez de un mapeo fijo — ver COLUMN_TITLE_ALIASES.
// ============================================================

import { redis } from '../../lib/redis'
import { EmployeeUpsertRow } from '../common'
import { splitFullName } from '../excel/excelParser'

export interface MondayCredentials {
  apiToken: string
  boardId:  string
}

export interface MondayBoard {
  id:   string
  name: string
}

export interface MondayColumn {
  id:    string
  title: string
}

interface MondayColumnValue {
  id:    string
  text:  string | null
  value: string | null
}

interface MondayItem {
  id:             string
  name:           string
  column_values:  MondayColumnValue[]
}

function credentialsKey(tenantId: string): string {
  return `t:${tenantId}:monday:credentials`
}

export async function getMondayCredentials(tenantId: string): Promise<MondayCredentials | null> {
  const raw = await redis.get(credentialsKey(tenantId))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return (parsed && typeof parsed === 'object') ? parsed : null
  } catch {
    return null
  }
}

export async function saveMondayCredentials(tenantId: string, creds: MondayCredentials): Promise<void> {
  await redis.set(credentialsKey(tenantId), JSON.stringify(creds))
}

export async function deleteMondayCredentials(tenantId: string): Promise<void> {
  await redis.del(credentialsKey(tenantId))
}

// ── Monday.com API (GraphQL) ──────────────────────────────────

const MONDAY_API_URL = 'https://api.monday.com/v2'

async function mondayGraphQL(apiToken: string, query: string, variables?: Record<string, unknown>): Promise<any> {
  const res = await fetch(MONDAY_API_URL, {
    method:  'POST',
    // Monday espera el token crudo en Authorization, sin prefijo "Bearer".
    headers: { 'Content-Type': 'application/json', Authorization: apiToken },
    body:    JSON.stringify({ query, variables }),
  })
  const body: any = await res.json().catch(() => ({}))
  if (!res.ok || body.errors) {
    throw new Error(body.errors?.[0]?.message || `Monday.com API error (${res.status})`)
  }
  return body.data
}

/** Boards accesibles con este token — para el selector de tablero en el modal de conexión. */
export async function getMondayBoards(apiToken: string): Promise<MondayBoard[]> {
  const data = await mondayGraphQL(apiToken, `query { boards (limit: 100) { id name } }`)
  return (data?.boards || []).map((b: any) => ({ id: String(b.id), name: b.name }))
}

async function fetchBoardColumns(apiToken: string, boardId: string): Promise<MondayColumn[]> {
  const data = await mondayGraphQL(
    apiToken,
    `query($boardId: [ID!]) { boards(ids: $boardId) { columns { id title } } }`,
    { boardId: [boardId] },
  )
  return data?.boards?.[0]?.columns || []
}

const ITEMS_PAGE_SIZE = 100

/** Pagina items_page completo (cursor-based) — cursor null en la respuesta = última página. */
async function fetchAllBoardItems(apiToken: string, boardId: string): Promise<MondayItem[]> {
  const items: MondayItem[] = []
  let cursor: string | null = null

  do {
    const data: any = await mondayGraphQL(
      apiToken,
      `query($boardId: [ID!], $cursor: String, $limit: Int) {
        boards(ids: $boardId) {
          items_page(limit: $limit, cursor: $cursor) {
            cursor
            items { id name column_values { id text value } }
          }
        }
      }`,
      { boardId: [boardId], cursor, limit: ITEMS_PAGE_SIZE },
    )
    const page = data?.boards?.[0]?.items_page
    if (!page) break
    items.push(...(page.items || []))
    cursor = page.cursor
  } while (cursor)

  return items
}

export async function fetchMondayBoardData(creds: MondayCredentials): Promise<{ columns: MondayColumn[]; items: MondayItem[] }> {
  const [columns, items] = await Promise.all([
    fetchBoardColumns(creds.apiToken, creds.boardId),
    fetchAllBoardItems(creds.apiToken, creds.boardId),
  ])
  return { columns, items }
}

// ── Smart matching por título de columna (case-insensitive) ──

// 'full_name' no es un campo real de EmployeeUpsertRow (employees.full_name
// es GENERATED ALWAYS AS first_name || ' ' || last_name en Postgres — no se
// puede escribir directo) — se resuelve con splitFullName() antes de armar
// la fila, igual que el conector Excel con la columna "Nombre completo".
type MondayTargetField = keyof EmployeeUpsertRow | 'full_name'

const COLUMN_TITLE_ALIASES: Record<string, MondayTargetField> = {
  'nombre': 'full_name', 'name': 'full_name', 'empleado': 'full_name',
  'email': 'email', 'correo': 'email',
  'teléfono': 'phone', 'telefono': 'phone', 'phone': 'phone',
  'departamento': 'department', 'department': 'department',
  'puesto': 'position', 'cargo': 'position', 'position': 'position',
  'fecha ingreso': 'hire_date', 'hire date': 'hire_date',
  'status': 'status', 'estatus': 'status',
  'rfc': 'rfc',
  'turno': 'shift', 'shift': 'shift',
  'planta': 'plant', 'plant': 'plant',
}

export interface MondayHeader {
  columnId: string | null // null = columna sintética (id/nombre del elemento, no viene de column_values)
  label:    string
  field:    MondayTargetField | null
}

/**
 * Arma la lista de "columnas" del board para el wizard: 2 sintéticas
 * siempre presentes (ID y nombre del elemento — todo item de Monday las
 * tiene, aun en boards sin columna RFC/nombre explícita, así que garantizan
 * un identificador estable para el upsert) + una por cada columna real del
 * board, marcada como mapeada (smart match) o sin mapear.
 */
export function buildMondayHeaders(columns: MondayColumn[]): MondayHeader[] {
  const headers: MondayHeader[] = []
  const hasExplicitFullName = columns.some((c) => COLUMN_TITLE_ALIASES[c.title.trim().toLowerCase()] === 'full_name')

  headers.push({ columnId: null, label: 'ID de elemento (Monday)', field: 'employee_code' })
  if (!hasExplicitFullName) {
    headers.push({ columnId: null, label: 'Nombre del elemento (Monday)', field: 'full_name' })
  }

  for (const col of columns) {
    const field = COLUMN_TITLE_ALIASES[col.title.trim().toLowerCase()] ?? null
    headers.push({ columnId: col.id, label: col.title, field })
  }

  return headers
}

/** Convierte un item de Monday a la fila canónica de upsertEmployee, usando el mapeo ya resuelto por buildMondayHeaders. */
export function mapMondayItemToEmployee(item: MondayItem, headers: MondayHeader[]): EmployeeUpsertRow & { full_name?: string } {
  const out: EmployeeUpsertRow & { full_name?: string } = { employee_code: item.id }

  let fullNameFromColumn: string | undefined

  for (const h of headers) {
    if (h.columnId == null || !h.field) continue
    const cv = item.column_values.find((c) => c.id === h.columnId)
    const text = cv?.text?.trim()
    if (!text) continue

    if (h.field === 'full_name') { fullNameFromColumn = text; continue }
    if (h.field === 'hire_date') {
      const d = new Date(text)
      if (!isNaN(d.getTime())) out.hire_date = d
      continue
    }
    ;(out as any)[h.field] = text
  }

  const fullName = fullNameFromColumn || item.name?.trim()
  if (fullName) {
    const { first_name, last_name } = splitFullName(fullName)
    out.first_name = first_name
    out.last_name  = last_name
    out.full_name  = fullName // conveniencia para el preview del wizard — ver routes/monday.ts
  }

  return out
}

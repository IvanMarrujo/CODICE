// ============================================================
// CÓDICE Agent · watcher — vigila los archivos configurados.
//
// EXCEL: pasa por el motor de deltas (diffEngine) — parsea el archivo,
// compara contra el último estado conocido y manda solo los campos que
// cambiaron por WebSocket. Si el cambio es grande (>= FULL_SYNC_THRESHOLD
// deltas — ej. la primera corrida, o un archivo reemplazado por completo)
// manda el archivo entero como fallback ('full_sync').
//
// DBF: sigue el flujo HTTP original (uploader.ts + checksum en
// agent-dbf-state.json) — el agente no trae parser DBF local, así que no
// hay forma de calcular un diff campo-por-campo sin duplicar dbffile
// (solo vive en apps/api). Subir el par EMPLEA/NOMINA completo cuando
// cambian sigue siendo correcto, solo que no aprovecha delta sync.
// ============================================================

import chokidar   from 'chokidar'
import * as fs     from 'fs'
import * as path   from 'path'
import * as crypto from 'crypto'
import { AgentConfig, SourceConfig } from './index'
import { AgentWSClient } from './wsClient'
import { DiffEngine, Delta } from './diffEngine'
import { parseWorkbook, ParsedRow } from './excelParser'
import { sendSync } from './uploader'

const FULL_SYNC_THRESHOLD = 50

const EMPLOYEE_FIELDS = new Set([
  'first_name', 'last_name', 'rfc', 'curp', 'nss', 'daily_salary', 'monthly_salary',
  'department', 'position', 'plant', 'shift', 'hire_date',
  'contract_type', 'status', 'employee_code', 'bank_name', 'bank_clabe', 'notes',
])

const PAYROLL_FIELDS = new Set([
  'folio', 'uuid_sat', 'payroll_type', 'period_start', 'period_end', 'payment_date',
  'days_paid', 'gross_taxable', 'gross_exempt', 'total_income', 'isr',
  'imss_employee', 'infonavit', 'other_deductions', 'total_deductions', 'net_pay',
  'period_label',
])

interface DbfState { checksums: Record<string, string> }
const DBF_STATE_PATH = path.join(__dirname, '..', 'agent-dbf-state.json')

function loadDbfState(): DbfState {
  try { return JSON.parse(fs.readFileSync(DBF_STATE_PATH, 'utf-8')) } catch { return { checksums: {} } }
}
function saveDbfState(state: DbfState) {
  fs.writeFileSync(DBF_STATE_PATH, JSON.stringify(state, null, 2))
}
function md5File(filePath: string): string {
  return crypto.createHash('md5').update(fs.readFileSync(filePath)).digest('hex')
}

/** DBF viaja como par (EMPLA/NOMINA) — Excel/CFDI son un solo archivo. */
function resolveFiles(source: SourceConfig): string[] {
  if (source.files && source.files.length > 0) {
    return source.files.map((f) => path.join(source.watchPath, f))
  }
  return [source.watchPath]
}

// Separa un delta "genérico" (todos los campos que cambiaron en la fila) en
// el subconjunto que aplica a `employees` y el que aplica a `payroll_records`
// — un mismo Excel de nómina trae ambos tipos de columna en la misma fila
// (ej. STATUS junto con ISR/PERCEPCIONES), pero el servidor los aplica a
// tablas distintas (ver lib/agentDelta.ts).
// Campos que identifican el recibo de nómina a actualizar (ver
// upsertPayrollRecord en apps/api/src/routes/connectors.ts) pero que no
// necesariamente cambiaron en este delta — sin ellos, un update parcial
// (ej. solo ISR) no puede hacer match contra el recibo existente y el
// servidor termina insertando uno nuevo en vez de actualizarlo.
const PAYROLL_IDENTITY_FIELDS = ['uuid_sat', 'period_start', 'period_end', 'period_label', 'payment_date']

function splitDelta(delta: Delta, currentRow?: ParsedRow): { employee?: Delta; payroll?: Delta } {
  if (delta.type === 'delete') {
    // El servidor ignora las bajas por delta a propósito (ver agentDelta.ts)
    // — se manda de todos modos para que quede constancia en delta:applied.
    return { employee: delta }
  }

  if (delta.type === 'insert') {
    const employeeData: Record<string, unknown> = {}
    const payrollData:  Record<string, unknown> = {}
    for (const [field, value] of Object.entries(delta.data || {})) {
      if (EMPLOYEE_FIELDS.has(field)) employeeData[field] = value
      if (PAYROLL_FIELDS.has(field))  payrollData[field] = value
    }
    return {
      employee: Object.keys(employeeData).length ? { code: delta.code, type: 'insert', data: employeeData } : undefined,
      payroll:  Object.keys(payrollData).length  ? { code: delta.code, type: 'insert', data: payrollData }  : undefined,
    }
  }

  const employeeChanges: Delta['changes'] = {}
  const payrollChanges:  Delta['changes'] = {}
  for (const [field, change] of Object.entries(delta.changes || {})) {
    if (EMPLOYEE_FIELDS.has(field)) employeeChanges![field] = change
    if (PAYROLL_FIELDS.has(field))  payrollChanges![field] = change
  }

  const payrollContext: Record<string, unknown> = {}
  if (currentRow) {
    for (const field of PAYROLL_IDENTITY_FIELDS) {
      if (currentRow[field] !== undefined && !payrollChanges![field]) payrollContext[field] = currentRow[field]
    }
  }

  return {
    employee: Object.keys(employeeChanges!).length ? { code: delta.code, type: 'update', changes: employeeChanges } : undefined,
    payroll:  Object.keys(payrollChanges!).length
      ? { code: delta.code, type: 'update', changes: payrollChanges, context: Object.keys(payrollContext).length ? payrollContext : undefined }
      : undefined,
  }
}

function summarizeChange(delta: Delta): string {
  const changes = delta.changes
  if (!changes) return `${delta.code}: ${delta.type}`
  // Prioriza net_pay como "campo titular" del resumen — es lo que de verdad
  // le importa al colaborador — y si no cambió, muestra el primer campo.
  const headline = changes.net_pay ? 'net_pay' : Object.keys(changes)[0]
  const c = changes[headline]
  return `${delta.code}: ${headline} ${c.from ?? '—'} → ${c.to}`
}

// debounceMs: 800ms — balance entre protección contra escrituras parciales
// y sensación de tiempo real. Nomipaq escribe el archivo de forma atómica
// al guardar, así que 800ms es suficiente contra lecturas parciales.
// Menor = sync más rápido. Mayor = más seguro en unidades de red lentas.
export function startWatchers(config: AgentConfig, wsClient: AgentWSClient, diffEngine: DiffEngine): void {
  const debounceTimers = new Map<string, NodeJS.Timeout>()
  const dbfState = loadDbfState()

  for (const source of config.sources) {
    if (!source.enabled) continue

    fs.mkdirSync(path.dirname(source.watchPath) === '.' ? source.watchPath : path.dirname(source.watchPath), { recursive: true })

    const watcher = chokidar.watch(source.watchPath, { ignoreInitial: true })

    const onFsEvent = (changedPath: string) => {
      const key = source.watchPath
      const existingTimer = debounceTimers.get(key)
      if (existingTimer) clearTimeout(existingTimer)

      debounceTimers.set(
        key,
        setTimeout(() => void handleDebouncedChange(config, source, wsClient, diffEngine, dbfState, changedPath), config.debounceMs)
      )
    }

    watcher.on('change', onFsEvent)
    watcher.on('add', onFsEvent)
  }
}

async function handleDebouncedChange(
  config: AgentConfig,
  source: SourceConfig,
  wsClient: AgentWSClient,
  diffEngine: DiffEngine,
  dbfState: DbfState,
  changedPath: string
) {
  try {
    if (source.type === 'EXCEL') {
      await handleExcelChange(source, wsClient, diffEngine, changedPath)
      return
    }
    await handleDbfChange(config, source, dbfState, changedPath)
  } catch (err: any) {
    console.error(`[watcher] ${source.type}: error al sincronizar —`, err.message)
  }
}

async function handleExcelChange(source: SourceConfig, wsClient: AgentWSClient, diffEngine: DiffEngine, changedPath: string) {
  if (!fs.existsSync(source.watchPath)) return

  // Si no hay conexión, sendDelta()/sendFullSync() serían no-ops silenciosos
  // — sin este guard, diffEngine.updateState() de todos modos marcaría el
  // cambio como "ya sincronizado" más abajo, y se perdería para siempre (el
  // reconnect-resync en index.ts/simulate.ts nunca lo detectaría porque el
  // estado ya coincidiría con el archivo). Se sale ANTES de tocar el estado,
  // así el próximo cambio de archivo — o el resync automático al reconectar —
  // sigue viendo el delta pendiente.
  if (!wsClient.isReady()) {
    console.log(`[watcher] EXCEL: sin conexión — "${changedPath}" se sincronizará al reconectar`)
    return
  }

  const rows = parseWorkbook(source.watchPath)
  const deltas = diffEngine.computeDeltas(rows)

  if (deltas.length === 0) {
    console.log(`[watcher] EXCEL: "${changedPath}" sin cambios reales — se ignora`)
    return
  }

  if (deltas.length >= FULL_SYNC_THRESHOLD) {
    console.log(`[watcher] EXCEL: ${deltas.length} cambios (>= ${FULL_SYNC_THRESHOLD}) — enviando archivo completo en vez de deltas`)
    const data = fs.readFileSync(source.watchPath).toString('base64')
    wsClient.sendFullSync('EXCEL', path.basename(source.watchPath), data)
    diffEngine.updateState(rows)
    return
  }

  console.log(`[watcher] EXCEL: ${deltas.length} cambios detectados · enviando via WebSocket`)
  for (const delta of deltas) console.log(`  · ${summarizeChange(delta)}`)

  const employeeDeltas: Delta[] = []
  const payrollDeltas:  Delta[] = []
  for (const delta of deltas) {
    const currentRow = rows.find((r) => (r.employee_code || r.rfc) === delta.code)
    const split = splitDelta(delta, currentRow)
    if (split.employee) employeeDeltas.push(split.employee)
    if (split.payroll)  payrollDeltas.push(split.payroll)
  }

  // El delta de empleado va primero y se espera su ack antes del de nómina
  // — un empleado nuevo (insert) tiene que existir en `employees` antes de
  // que el servidor pueda resolver employee_code -> employee_id para el
  // delta de payroll correspondiente (ver lib/agentDelta.ts).
  if (employeeDeltas.length) await wsClient.sendDelta('employee', employeeDeltas)
  if (payrollDeltas.length)  await wsClient.sendDelta('payroll', payrollDeltas)

  diffEngine.updateState(rows)
  console.log(`[watcher] EXCEL: Detected ${deltas.length} changes · sent via WebSocket`)
}

// Se llama en cada auth_ok (primera conexión y cada reconexión) — atrapa
// cualquier cambio que haya quedado pendiente mientras el agente estuvo
// desconectado (chokidar no vuelve a emitir 'change' solo porque el socket
// se reconectó, así que sin esto ese cambio se quedaría sin mandar hasta el
// siguiente guardado real del archivo).
export async function resyncExcelSources(config: AgentConfig, wsClient: AgentWSClient, diffEngine: DiffEngine): Promise<void> {
  for (const source of config.sources) {
    if (!source.enabled || source.type !== 'EXCEL') continue
    try {
      await handleExcelChange(source, wsClient, diffEngine, '(resync tras conexión)')
    } catch (err: any) {
      console.error(`[watcher] EXCEL: error en resync —`, err.message)
    }
  }
}

async function handleDbfChange(config: AgentConfig, source: SourceConfig, state: DbfState, changedPath: string) {
  const files = resolveFiles(source).filter((f) => fs.existsSync(f))
  if (files.length === 0) return

  const combinedChecksum = crypto
    .createHash('md5')
    .update(files.map((f) => md5File(f)).sort().join(':'))
    .digest('hex')

  if (state.checksums[source.watchPath] === combinedChecksum) {
    console.log(`[watcher] DBF: "${changedPath}" sin cambios reales (mismo checksum) — se ignora`)
    return
  }

  console.log(`[watcher] DBF: cambio detectado en "${changedPath}" — subiendo archivo completo (sin delta engine para DBF)…`)
  await sendSync(config, source, files)

  state.checksums[source.watchPath] = combinedChecksum
  saveDbfState(state)
}

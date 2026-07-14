// ============================================================
// CÓDICE Agent · watcher — vigila los archivos configurados y, con
// debounce, compara checksum contra agent-state.json antes de subir
// (evita subir por un simple "tocar" el archivo sin cambios reales).
// ============================================================

import chokidar   from 'chokidar'
import * as fs     from 'fs'
import * as path   from 'path'
import * as crypto from 'crypto'
import { AgentConfig, SourceConfig } from './index'
import { sendSync } from './uploader'

interface AgentState {
  checksums: Record<string, string> // source.watchPath -> md5 combinado
}

const STATE_PATH = path.join(__dirname, '..', 'agent-state.json')

function loadState(): AgentState {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'))
  } catch {
    return { checksums: {} }
  }
}

function saveState(state: AgentState) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2))
}

function md5File(filePath: string): string {
  return crypto.createHash('md5').update(fs.readFileSync(filePath)).digest('hex')
}

/** DBF viaja como par (EMPLEA/NOMINA) — Excel/CFDI son un solo archivo. */
function resolveFiles(source: SourceConfig): string[] {
  if (source.files && source.files.length > 0) {
    return source.files.map((f) => path.join(source.watchPath, f))
  }
  return [source.watchPath]
}

export function startWatchers(config: AgentConfig): void {
  const state = loadState()
  const debounceTimers = new Map<string, NodeJS.Timeout>()

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
        setTimeout(() => void handleDebouncedChange(config, source, state, changedPath), config.debounceMs)
      )
    }

    watcher.on('change', onFsEvent)
    watcher.on('add', onFsEvent)
  }
}

async function handleDebouncedChange(config: AgentConfig, source: SourceConfig, state: AgentState, changedPath: string) {
  try {
    const files = resolveFiles(source).filter((f) => fs.existsSync(f))
    if (files.length === 0) return

    const combinedChecksum = crypto
      .createHash('md5')
      .update(files.map((f) => md5File(f)).sort().join(':'))
      .digest('hex')

    if (state.checksums[source.watchPath] === combinedChecksum) {
      console.log(`[watcher] ${source.type}: "${changedPath}" sin cambios reales (mismo checksum) — se ignora`)
      return
    }

    console.log(`[watcher] ${source.type}: cambio detectado en "${changedPath}" — subiendo…`)
    await sendSync(config, source, files)

    state.checksums[source.watchPath] = combinedChecksum
    saveState(state)
  } catch (err: any) {
    console.error(`[watcher] ${source.type}: error al sincronizar —`, err.message)
  }
}

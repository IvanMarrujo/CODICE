// ============================================================
// CÓDICE Agent — monitorea archivos de nómina locales (Nomipaq DBF,
// Excel) y avisa a CÓDICE en cuanto cambian. Modo WebSocket: se conecta
// una sola vez a /ws/agent y manda solo los campos que cambiaron (delta
// sync) — sin subir el archivo completo en cada cambio. Corre en la
// máquina del cliente, fuera del monorepo de la app.
// ============================================================

import * as fs   from 'fs'
import * as path from 'path'
import { startWatchers } from './watcher'
import { AgentWSClient } from './wsClient'
import { DiffEngine } from './diffEngine'

export interface SourceConfig {
  type:      'EXCEL' | 'DBF' | 'CFDI'
  watchPath: string
  files?:    string[]
  enabled:   boolean
}

export interface AgentConfig {
  apiUrl:                   string
  tenantId:                 string
  webhookSecret:            string
  agentVersion:             string
  sources:                  SourceConfig[]
  debounceMs:               number
  heartbeatIntervalSeconds: number
}

export function loadConfig(configPath?: string): AgentConfig {
  const resolved = configPath || path.join(__dirname, '..', 'config.json')
  const raw = fs.readFileSync(resolved, 'utf-8')
  return JSON.parse(raw)
}

export function printBanner(config: AgentConfig) {
  const wsUrl = `${config.apiUrl.replace(/^http/, 'ws')}/ws/agent`
  console.log(`\n✦ CÓDICE Agent v${config.agentVersion} · WebSocket Mode`)
  console.log(`  Conexión: ${wsUrl}`)
  for (const source of config.sources.filter((s) => s.enabled)) {
    console.log(`  Monitoreando: ${source.watchPath} (${source.type})`)
  }
  console.log(`  Tenant: ${config.tenantId}`)
}

function main() {
  const config = loadConfig()
  printBanner(config)

  const diffEngine = new DiffEngine()
  const wsClient = new AgentWSClient(config, () => {
    console.log('  Estado: CONECTADO\n')
    startWatchers(config, wsClient, diffEngine)
  })
  wsClient.connect()
  // Keep-alive: los watchers de chokidar y el socket abierto ya mantienen
  // vivo el event loop — no hace falta un timer extra.
}

if (require.main === module) main()

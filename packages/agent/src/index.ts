// ============================================================
// CÓDICE Agent — monitorea archivos de nómina locales (Nomipaq DBF,
// Excel) y avisa a CÓDICE en cuanto cambian, vía el webhook HMAC de
// apps/api/src/routes/webhook.ts. Corre en la máquina del cliente,
// fuera del monorepo de la app.
// ============================================================

import * as fs   from 'fs'
import * as path from 'path'
import { startWatchers } from './watcher'
import { startHeartbeat } from './heartbeat'

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
  console.log(`\n✦ CÓDICE Agent v${config.agentVersion}`)
  for (const source of config.sources.filter((s) => s.enabled)) {
    console.log(`  Monitoreando: ${source.watchPath} (${source.type})`)
  }
  console.log(`  Tenant: ${config.tenantId}`)
  console.log(`  Estado: ACTIVO\n`)
}

function main() {
  const config = loadConfig()
  printBanner(config)
  startWatchers(config)
  startHeartbeat(config)
  // Keep-alive: los watchers de chokidar y el setInterval del heartbeat ya
  // mantienen vivo el event loop — no hace falta un timer extra.
}

if (require.main === module) main()

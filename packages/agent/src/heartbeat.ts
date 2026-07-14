// ============================================================
// CÓDICE Agent · heartbeat — avisa que el agente sigue vivo cada
// `heartbeatIntervalSeconds` (POST /api/webhook/heartbeat/:tenantId,
// TTL de 90s en Redis — ver GET /api/connectors/agent-status/:tenantId).
// ============================================================

import axios       from 'axios'
import * as os      from 'os'
import * as crypto  from 'crypto'
import { AgentConfig } from './index'

function signedHeaders(config: AgentConfig): Record<string, string> {
  const timestamp = Date.now().toString()
  const signature = crypto
    .createHmac('sha256', config.webhookSecret)
    .update(`${config.tenantId}:${timestamp}`)
    .digest('hex')
  return { 'X-Codice-Secret': signature, 'X-Timestamp': timestamp }
}

export function startHeartbeat(config: AgentConfig, getLastChecksum?: () => string | undefined): void {
  const send = async () => {
    try {
      await axios.post(
        `${config.apiUrl}/api/webhook/heartbeat/${config.tenantId}`,
        {
          agentVersion: config.agentVersion,
          watchedPaths: config.sources.filter((s) => s.enabled).map((s) => s.watchPath),
          os:           `${os.platform()} ${os.release()}`,
          lastChecksum: getLastChecksum?.(),
        },
        { headers: signedHeaders(config) }
      )
    } catch (err: any) {
      console.error('[heartbeat] error:', err.response?.data?.error || err.message)
    }
  }

  void send() // inmediato al arrancar, luego cada heartbeatIntervalSeconds
  setInterval(send, config.heartbeatIntervalSeconds * 1000)
}

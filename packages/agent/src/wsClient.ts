// ============================================================
// CÓDICE Agent · wsClient — conexión persistente a /ws/agent.
// Autentica con el mismo HMAC que el webhook HTTP (routes/webhook.ts),
// reconecta con backoff exponencial (1s → 2s → 4s → … → máx 30s) y
// resuelve sendDelta()/sendFullSync() cuando llega el ack correspondiente
// (correlación por reqId — evita mandar el delta de nómina de un
// empleado antes de que el servidor haya confirmado que el empleado
// existe, ver watcher.ts).
// ============================================================

import WebSocket from 'ws'
import * as crypto from 'crypto'
import * as os from 'os'
import { AgentConfig } from './index'
import { Delta } from './diffEngine'

const MAX_RECONNECT_DELAY_MS = 30000
const HEARTBEAT_INTERVAL_MS  = 30000
const PENDING_TIMEOUT_MS     = 15000

interface DeltaResult {
  code: string
  status: 'ok' | 'error'
  result?: any
  error?: string
}

function signedAuth(config: AgentConfig) {
  const timestamp = Date.now()
  const signature = crypto.createHmac('sha256', config.webhookSecret).update(`${config.tenantId}:${timestamp}`).digest('hex')
  return { tenantId: config.tenantId, signature, timestamp }
}

export class AgentWSClient {
  private ws: WebSocket | null = null
  private reconnectDelay = 1000
  private authenticated = false
  private closedByUser = false
  private heartbeatTimer: NodeJS.Timeout | null = null
  private pending = new Map<string, (results: DeltaResult[]) => void>()
  private reqCounter = 0

  constructor(private config: AgentConfig, private onAuthReady: () => void) {}

  connect(): void {
    const url = `${this.config.apiUrl.replace(/^http/, 'ws')}/ws/agent`
    this.ws = new WebSocket(url)

    this.ws.on('open', () => this.authenticate())
    this.ws.on('message', (data) => this.onMessage(data))
    this.ws.on('close', () => this.onClose())
    this.ws.on('error', (err: Error) => console.error('[CÓDICE] Error de conexión:', err?.message || err))
  }

  isReady(): boolean {
    return this.authenticated
  }

  /** Manda un lote de deltas y resuelve con los resultados del ack (o [] si no hay conexión / timeout). */
  sendDelta(entity: 'employee' | 'payroll' | 'attendance', deltas: Delta[]): Promise<DeltaResult[]> {
    if (!this.authenticated || !this.ws || deltas.length === 0) return Promise.resolve([])

    const reqId = `r${++this.reqCounter}`
    const promise = new Promise<DeltaResult[]>((resolve) => {
      this.pending.set(reqId, resolve)
      setTimeout(() => {
        if (this.pending.delete(reqId)) resolve([])
      }, PENDING_TIMEOUT_MS)
    })

    this.ws.send(JSON.stringify({ type: 'delta', entity, deltas, reqId }))
    return promise
  }

  /** Fallback cuando el cambio es demasiado grande para deltas — sube el archivo completo (base64). */
  sendFullSync(sourceType: 'EXCEL' | 'CFDI', fileName: string, dataBase64: string): void {
    if (!this.authenticated || !this.ws) return
    this.ws.send(JSON.stringify({ type: 'full_sync', sourceType, fileName, data: dataBase64 }))
  }

  close(): void {
    this.closedByUser = true
    this.stopHeartbeat()
    this.ws?.close()
  }

  private authenticate(): void {
    this.ws?.send(JSON.stringify({ type: 'auth', ...signedAuth(this.config) }))
  }

  private onMessage(data: WebSocket.RawData): void {
    let msg: any
    try {
      msg = JSON.parse(data.toString())
    } catch {
      return
    }

    switch (msg.type) {
      case 'auth_ok':
        this.authenticated = true
        this.reconnectDelay = 1000
        console.log('[CÓDICE] ✅ Autenticado · tenant:', msg.tenantId)
        this.startHeartbeat()
        this.onAuthReady()
        break

      case 'auth_error':
        console.error('[CÓDICE] ❌ Autenticación fallida:', msg.message)
        break

      case 'delta_ack': {
        const results: DeltaResult[] = msg.results || []
        const ok = results.filter((r) => r.status === 'ok').length
        console.log(`[CÓDICE] ✅ Delta aplicado: ${ok}/${results.length} registros`)
        if (msg.reqId) {
          const resolve = this.pending.get(msg.reqId)
          if (resolve) { this.pending.delete(msg.reqId); resolve(results) }
        }
        break
      }

      case 'full_sync_queued':
        console.log('[CÓDICE] ✅ Sincronización completa encolada · sourceId=', msg.sourceId)
        break

      case 'error':
        console.error('[CÓDICE] ⚠️ Error del servidor:', msg.message)
        break
    }
  }

  private onClose(): void {
    this.authenticated = false
    this.stopHeartbeat()
    if (this.closedByUser) return

    console.log(`[CÓDICE] ⚡ Desconectado · reconectando en ${this.reconnectDelay}ms`)
    setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS)
      this.connect()
    }, this.reconnectDelay)
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (!this.authenticated || !this.ws) return
      this.ws.send(JSON.stringify({
        type:         'heartbeat',
        agentVersion: this.config.agentVersion,
        watchedPaths: this.config.sources.filter((s) => s.enabled).map((s) => s.watchPath),
        os:           `${os.platform()} ${os.release()}`,
      }))
    }, HEARTBEAT_INTERVAL_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }
}

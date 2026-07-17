// ============================================================
// CÓDICE · Agent WebSocket — /ws/agent
// Contraparte en tiempo real del webhook HMAC (routes/webhook.ts): en vez
// de subir el archivo completo en cada cambio, el agente manda solo los
// campos que cambiaron (delta) — mismo HMAC, mismo tenant, mismos upserts
// whitelisted (lib/agentDelta.ts), pero sin pasar por la cola de ETL para
// el caso común. `full_sync` sigue disponible como fallback: reusa
// exactamente upsertConnectedSource() + la cola 'auto-sync', igual que
// POST /api/webhook/sync.
// ============================================================

import type { Server as HttpServer } from 'http'
import type { Server as SocketIOServer } from 'socket.io'
import { WebSocketServer, WebSocket, RawData } from 'ws'
import * as crypto from 'crypto'
import { redis } from './redis'
import { prismaPublic } from './prisma'
import { getTenantPrisma } from '../middleware/tenant'
import { applyDelta, AgentDelta } from './agentDelta'
import { autoSyncQueue } from '../jobs/autoSyncQueue'
import { upsertConnectedSource } from '../routes/connectors'
import { WEBHOOK_SECRET, TIMESTAMP_TOLERANCE_MS } from '../routes/webhook'

const MAX_DELTAS_PER_MESSAGE = 200
const MAX_FULL_SYNC_BYTES    = 20 * 1024 * 1024
const FULL_SYNC_EXT_BY_SOURCE_TYPE: Record<string, string> = { EXCEL: 'xlsx', CFDI: 'xml' }

function verifySignature(tenantId: unknown, timestamp: unknown, signature: unknown): tenantId is string {
  if (typeof tenantId !== 'string' || typeof signature !== 'string' || typeof timestamp !== 'number') return false
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > TIMESTAMP_TOLERANCE_MS) return false
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(`${tenantId}:${timestamp}`).digest('hex')
  const sigBuf = Buffer.from(signature)
  const expBuf = Buffer.from(expected)
  return sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf)
}

async function resolveActiveTenant(tenantId: string): Promise<{ dbSchema: string } | null> {
  const tenant = await prismaPublic.tenant.findUnique({
    where:  { id: tenantId },
    select: { dbSchema: true, status: true },
  })
  if (!tenant || tenant.status !== 'ACTIVE') return null
  return { dbSchema: tenant.dbSchema }
}

function safeSend(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload))
}

export function attachAgentWebSocket(server: HttpServer, io: SocketIOServer): void {
  const wss = new WebSocketServer({ server, path: '/ws/agent' })

  wss.on('connection', (ws: WebSocket) => {
    let tenantId: string | null = null
    let authenticated = false

    const pingInterval = setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.ping()
    }, 30000)

    ws.on('message', async (raw: RawData) => {
      let msg: any
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        safeSend(ws, { type: 'error', message: 'JSON inválido' })
        return
      }

      if (msg?.type === 'auth') {
        const { tenantId: tid, signature, timestamp } = msg
        if (!verifySignature(tid, timestamp, signature)) {
          safeSend(ws, { type: 'auth_error', message: 'Invalid signature' })
          ws.close()
          return
        }
        const tenant = await resolveActiveTenant(tid)
        if (!tenant) {
          safeSend(ws, { type: 'auth_error', message: 'Tenant no encontrado o inactivo' })
          ws.close()
          return
        }
        tenantId = tid
        authenticated = true
        safeSend(ws, { type: 'auth_ok', tenantId })
        await redis.set(`t:${tenantId}:agent:heartbeat`, JSON.stringify({ ts: Date.now(), mode: 'websocket' }), 'EX', 90)
        return
      }

      if (!authenticated || !tenantId) { ws.close(); return }

      if (msg.type === 'heartbeat') {
        await redis.set(
          `t:${tenantId}:agent:heartbeat`,
          JSON.stringify({ ts: Date.now(), mode: 'websocket', agentVersion: msg.agentVersion, watchedPaths: msg.watchedPaths, os: msg.os }),
          'EX', 90
        )
        safeSend(ws, { type: 'heartbeat_ack' })
        return
      }

      if (msg.type === 'delta') {
        await handleDelta(ws, io, tenantId, msg)
        return
      }

      if (msg.type === 'full_sync') {
        await handleFullSync(ws, tenantId, msg)
        return
      }
    })

    ws.on('close', () => {
      clearInterval(pingInterval)
      if (tenantId) io.to(`tenant:${tenantId}`).emit('agent:disconnected', { tenantId })
    })

    ws.on('error', () => { /* 'close' sigue disparándose después — nada más que hacer aquí */ })
  })
}

async function handleDelta(ws: WebSocket, io: SocketIOServer, tenantId: string, msg: any): Promise<void> {
  const entity = msg.entity as 'employee' | 'payroll' | 'attendance'
  const deltas: AgentDelta[] = Array.isArray(msg.deltas) ? msg.deltas.slice(0, MAX_DELTAS_PER_MESSAGE) : []
  if (!['employee', 'payroll', 'attendance'].includes(entity) || deltas.length === 0) {
    safeSend(ws, { type: 'delta_ack', results: [] })
    return
  }

  const tenant = await resolveActiveTenant(tenantId)
  if (!tenant) { safeSend(ws, { type: 'error', message: 'Tenant inactivo' }); return }

  const tenantDb = await getTenantPrisma(tenant.dbSchema)
  await tenantDb.$executeRawUnsafe(`SET search_path = "${tenant.dbSchema}", public`)

  const results: { code: string; status: 'ok' | 'error'; result?: any; error?: string }[] = []
  for (const delta of deltas) {
    try {
      const result = await applyDelta(tenantDb, tenantId, entity, delta)
      results.push({ code: delta.code, status: 'ok', result })
    } catch (err: any) {
      results.push({ code: delta.code, status: 'error', error: err.message || 'Error al aplicar delta' })
    }
  }

  await redis.incrby(`t:${tenantId}:agent:delta_count`, deltas.length)
  await redis.expire(`t:${tenantId}:agent:delta_count`, 90000) // ventana ~25h — cubre "últimas 24h" con margen

  io.to(`tenant:${tenantId}`).emit('delta:applied', { entity, count: deltas.length, results })

  const okResults = results.filter((r) => r.status === 'ok')
  for (const r of okResults) {
    if (entity === 'payroll' && r.result?.employeeId) {
      io.to(`employee:${r.result.employeeId}`).emit('payroll:updated', {
        employeeId:   r.result.employeeId,
        newNeto:      r.result.newNeto,
        previousNeto: r.result.previousNeto,
        diff:         r.result.diff,
        updatedAt:    new Date().toISOString(),
      })
      // La invalidación del cache de explicación IA (`t:{tid}:ai:payroll:{id}`)
      // ya ocurre dentro de upsertPayrollRecord — no hay que repetirla aquí.
    }
  }
  if (entity === 'attendance' && okResults.length > 0) {
    io.to(`tenant:${tenantId}`).emit('headcount:refresh', {})
  }

  safeSend(ws, { type: 'delta_ack', reqId: msg.reqId, results })
}

async function handleFullSync(ws: WebSocket, tenantId: string, msg: any): Promise<void> {
  try {
    const sourceType = msg.sourceType as string
    const ext = FULL_SYNC_EXT_BY_SOURCE_TYPE[sourceType]
    if (!ext) {
      safeSend(ws, { type: 'error', message: 'full_sync solo soporta EXCEL o CFDI vía WebSocket — usa el webhook HTTP para DBF' })
      return
    }
    if (typeof msg.data !== 'string' || !msg.data) {
      safeSend(ws, { type: 'error', message: 'full_sync requiere "data" en base64' })
      return
    }

    // Mismo límite de "noisy neighbor" que POST /api/webhook/sync.
    const rateKey = `t:${tenantId}:webhook:rate`
    const recentSyncs = await redis.get(rateKey)
    if (recentSyncs && parseInt(recentSyncs, 10) > 10) {
      safeSend(ws, { type: 'error', message: 'Demasiadas sincronizaciones. Intenta en unos minutos.' })
      return
    }
    await redis.incr(rateKey)
    await redis.expire(rateKey, 3600)

    const tenant = await resolveActiveTenant(tenantId)
    if (!tenant) { safeSend(ws, { type: 'error', message: 'Tenant inactivo' }); return }

    const buffer = Buffer.from(msg.data, 'base64')
    if (buffer.length === 0 || buffer.length > MAX_FULL_SYNC_BYTES) {
      safeSend(ws, { type: 'error', message: 'Archivo vacío o demasiado grande (máx 20MB)' })
      return
    }
    const fileName = typeof msg.fileName === 'string' && msg.fileName ? msg.fileName : `agent.${ext}`

    const tenantDb = await getTenantPrisma(tenant.dbSchema)
    await tenantDb.$executeRawUnsafe(`SET search_path = "${tenant.dbSchema}", public`)

    await upsertConnectedSource(tenantDb, tenantId, sourceType as 'EXCEL' | 'CFDI', [{ buffer, originalname: fileName }])
    const sourceRows = await tenantDb.$queryRaw<{ id: string }[]>`
      SELECT id FROM connected_sources WHERE tenant_id = ${tenantId} AND type = ${sourceType} LIMIT 1
    `
    const sourceId = sourceRows[0]?.id
    if (!sourceId) { safeSend(ws, { type: 'error', message: 'No se pudo registrar la fuente conectada' }); return }

    await autoSyncQueue.add(
      'webhook-sync',
      { tenantId, sourceType, sourceId, triggeredBy: 'agent_ws' },
      { attempts: 3, backoff: { type: 'exponential', delay: 2000 } }
    )

    safeSend(ws, { type: 'full_sync_queued', sourceId })
  } catch (err: any) {
    safeSend(ws, { type: 'error', message: err.message || 'Error al procesar full_sync' })
  }
}

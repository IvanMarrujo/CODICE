// ============================================================
// CÓDICE · Auto-sync queue (BullMQ, in-process)
// Re-corre el ETL de una `connected_source` cada `sync_interval_minutes`
// mientras `auto_sync = true`. Corre dentro del mismo proceso que la API
// (ver index.ts) — no hay un proceso `worker` separado en este proyecto.
// ============================================================

import { Queue, Worker, Job } from 'bullmq'
import { getTenantPrisma }    from '../middleware/tenant'
import { prismaPublic }       from '../lib/prisma'

const QUEUE_NAME = 'auto-sync'

// BullMQ requiere maxRetriesPerRequest: null y bloquea internamente sobre su
// propia conexión ioredis — se le pasa un objeto de opciones (no una
// instancia de `Redis` de lib/redis.ts) porque bullmq trae su propia copia
// de ioredis en node_modules, y una instancia de la copia raíz no es
// estructuralmente compatible con su tipo `ConnectionOptions`.
const redisUrl = new URL(process.env.REDIS_URL || 'redis://localhost:6379')
const connection = {
  host:                 redisUrl.hostname,
  port:                 Number(redisUrl.port) || 6379,
  password:             redisUrl.password || undefined,
  maxRetriesPerRequest: null as null,
}

export const autoSyncQueue = new Queue(QUEUE_NAME, { connection })

interface AutoSyncJobData {
  tenantId:     string
  sourceId:     string
  // Presentes solo en jobs 'webhook-sync' (disparados por el agente) —
  // informativos para logging/sync:error, no cambian el reload en sí.
  sourceType?:   string
  triggeredBy?:  string
  agentVersion?: string
  priority?:     number
}

interface NotifyEmployeeJobData {
  tenantId:   string
  employeeId: string
  type:       string
  title:      string
  body:       string
  link:       string
}

type AnyJobData = AutoSyncJobData | NotifyEmployeeJobData

function isNotifyEmployeeJob(data: AnyJobData): data is NotifyEmployeeJobData {
  return 'employeeId' in data
}

type ReloadFn = (tenantId: string, tenantDb: any, io: any, sourceId: string) => Promise<unknown>

let worker: Worker<AnyJobData> | null = null

/**
 * Arranca el worker una sola vez, desde index.ts, después de crear `io` —
 * así los jobs pueden emitir los mismos eventos de Socket.io que /reload.
 * `runReload` se inyecta (en vez de importar routes/connectors aquí
 * directamente) para evitar un import circular entre este archivo y
 * routes/connectors.ts (que sí importa registerAutoSync/unregisterAutoSync).
 *
 * Maneja 3 tipos de job (mismo worker, misma cola — ver "no restructurar"):
 *   'sync'          — auto-sync programado (repetible, ver registerAutoSync)
 *   'webhook-sync'  — disparado por el agente/Nomipaq vía POST /api/webhook/sync
 *   'notify-employee' — inserta una notificación in-app (encolada por syncEmitter)
 * 'sync' y 'webhook-sync' hacen exactamente lo mismo (re-correr el ETL sobre
 * el archivo ya almacenado en connected_sources) — por eso comparten código.
 */
export function startAutoSyncWorker(io: any, runReload: ReloadFn): Worker<AnyJobData> {
  if (worker) return worker

  worker = new Worker<AnyJobData>(
    QUEUE_NAME,
    async (job: Job<AnyJobData>) => {
      const { tenantId } = job.data

      const tenant = await prismaPublic.tenant.findUnique({
        where:  { id: tenantId },
        select: { dbSchema: true, status: true },
      })
      // Tenant suspendido/cancelado desde que se agendó el job: no procesar.
      if (!tenant || tenant.status !== 'ACTIVE') return

      const tenantDb = await getTenantPrisma(tenant.dbSchema)
      await tenantDb.$executeRawUnsafe(`SET search_path = "${tenant.dbSchema}", public`)

      if (isNotifyEmployeeJob(job.data)) {
        const { employeeId, type, title, body, link } = job.data
        await tenantDb.$executeRaw`
          INSERT INTO notifications (tenant_id, employee_id, type, title, body, link)
          VALUES (${tenantId}, ${employeeId}, ${type}, ${title}, ${body}, ${link})
        `
        return
      }

      await runReload(tenantId, tenantDb, io, job.data.sourceId)
    },
    { connection }
  )

  worker.on('failed', (job, err) => {
    console.error(`❌  job "${job?.name}" falló (${JSON.stringify(job?.data)}):`, err.message)

    // Solo para 'webhook-sync', y solo cuando ya se agotaron los reintentos —
    // el admin no necesita ver un error transitorio a medio reintentar.
    if (job?.name === 'webhook-sync') {
      const data = job.data as AutoSyncJobData
      const attemptsMax = job.opts?.attempts ?? 1
      if (job.attemptsMade >= attemptsMax) {
        io?.to(`tenant:${data.tenantId}`).emit('sync:error', {
          sourceType: data.sourceType,
          error:      job.failedReason || err.message,
          retries:    job.attemptsMade,
        })
      }
    }
  })

  return worker
}

// El `name` del job (no `jobId`) es lo único que identifica de forma
// confiable a QUÉ source pertenece un job repetible: esta versión de BullMQ
// no expone `id`/`jobId` en getRepeatableJobs(), solo `{ key, name, every,
// ... }` — y `key` es un hash de {name, every, pattern, tz}, así que dos
// sources con el MISMO intervalo y un `name` compartido ("sync") colisionan
// en la misma entrada. Un nombre único por source evita ambas cosas.
function repeatJobName(sourceId: string): string {
  return `sync:${sourceId}`
}

/** Registra (o re-registra, si ya existía) el job repetible de un source. */
export async function registerAutoSync(sourceId: string, tenantId: string, intervalMinutes: number): Promise<void> {
  await unregisterAutoSync(sourceId)
  await autoSyncQueue.add(
    repeatJobName(sourceId),
    { tenantId, sourceId },
    { repeat: { every: intervalMinutes * 60_000 } }
  )
}

/** Quita el/los job(s) repetible(s) de un source (auto-sync desactivado o reconfigurado). */
export async function unregisterAutoSync(sourceId: string): Promise<void> {
  const repeatables = await autoSyncQueue.getRepeatableJobs()
  const matches = repeatables.filter((r) => r.name === repeatJobName(sourceId))
  for (const match of matches) await autoSyncQueue.removeRepeatableByKey(match.key)
}

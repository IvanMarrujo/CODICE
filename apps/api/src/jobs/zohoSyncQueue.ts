// ============================================================
// CÓDICE · Zoho People sync queue (BullMQ, in-process)
// Job on-demand (no repetible, a diferencia de auto-sync/autoSyncQueue.ts) —
// "Sincronizar" en el wizard encola uno y el worker corre syncZohoPeople.
// Cola propia (no la de autoSyncQueue.ts) para no tocar su dispatch de tipos
// de job ya existente — mismo patrón de conexión ioredis dedicada, ver
// comentario en autoSyncQueue.ts sobre por qué no se comparte una instancia.
// ============================================================

import { Queue, Worker, Job } from 'bullmq'
import { getTenantPrisma }    from '../middleware/tenant'
import { prismaPublic }       from '../lib/prisma'

const QUEUE_NAME = 'zoho-sync'

const redisUrl = new URL(process.env.REDIS_URL || 'redis://localhost:6379')
const connection = {
  host:                 redisUrl.hostname,
  port:                 Number(redisUrl.port) || 6379,
  password:             redisUrl.password || undefined,
  maxRetriesPerRequest: null as null,
}

export const zohoSyncQueue = new Queue(QUEUE_NAME, { connection })

interface ZohoSyncJobData {
  tenantId: string
}

type SyncFn = (tenantId: string, tenantDb: any, io: any) => Promise<unknown>

let worker: Worker<ZohoSyncJobData> | null = null

/** Arranca el worker una sola vez, desde index.ts — mismo motivo que startAutoSyncWorker (io para Socket.io). */
export function startZohoSyncWorker(io: any, runSync: SyncFn): Worker<ZohoSyncJobData> {
  if (worker) return worker

  worker = new Worker<ZohoSyncJobData>(
    QUEUE_NAME,
    async (job: Job<ZohoSyncJobData>) => {
      const { tenantId } = job.data

      const tenant = await prismaPublic.tenant.findUnique({
        where:  { id: tenantId },
        select: { dbSchema: true, status: true },
      })
      if (!tenant || tenant.status !== 'ACTIVE') return

      const tenantDb = await getTenantPrisma(tenant.dbSchema)
      await tenantDb.$executeRawUnsafe(`SET search_path = "${tenant.dbSchema}", public`)

      await runSync(tenantId, tenantDb, io)
    },
    { connection }
  )

  worker.on('failed', (job, err) => {
    console.error(`❌  job "zoho-sync" falló (tenant ${job?.data.tenantId}):`, err.message)
    io?.to(`tenant:${job?.data.tenantId}`).emit('sync:error', {
      sourceType: 'ZOHO',
      error:      job?.failedReason || err.message,
    })
  })

  return worker
}

export async function queueZohoSync(tenantId: string): Promise<string> {
  const job = await zohoSyncQueue.add('zoho-sync', { tenantId })
  return job.id!
}

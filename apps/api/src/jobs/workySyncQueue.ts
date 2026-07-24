// ============================================================
// CÓDICE · Worky sync queue (BullMQ, in-process)
// Job on-demand — mismo patrón que runaSyncQueue.ts. Cola propia (no la de
// autoSyncQueue.ts) para no tocar su dispatch de tipos de job ya existente.
// ============================================================

import { Queue, Worker, Job } from 'bullmq'
import { getTenantPrisma }    from '../middleware/tenant'
import { prismaPublic }       from '../lib/prisma'

const QUEUE_NAME = 'worky-sync'

const redisUrl = new URL(process.env.REDIS_URL || 'redis://localhost:6379')
const connection = {
  host:                 redisUrl.hostname,
  port:                 Number(redisUrl.port) || 6379,
  password:             redisUrl.password || undefined,
  maxRetriesPerRequest: null as null,
}

export const workySyncQueue = new Queue(QUEUE_NAME, { connection })

interface WorkySyncJobData {
  tenantId: string
}

type SyncFn = (tenantId: string, tenantDb: any, io: any) => Promise<unknown>

let worker: Worker<WorkySyncJobData> | null = null

/** Arranca el worker una sola vez, desde index.ts — mismo motivo que startAutoSyncWorker (io para Socket.io). */
export function startWorkySyncWorker(io: any, runSync: SyncFn): Worker<WorkySyncJobData> {
  if (worker) return worker

  worker = new Worker<WorkySyncJobData>(
    QUEUE_NAME,
    async (job: Job<WorkySyncJobData>) => {
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
    console.error(`❌  job "worky-sync" falló (tenant ${job?.data.tenantId}):`, err.message)
    io?.to(`tenant:${job?.data.tenantId}`).emit('sync:error', {
      sourceType: 'WORKY',
      error:      job?.failedReason || err.message,
    })
  })

  return worker
}

export async function queueWorkySync(tenantId: string): Promise<string> {
  const job = await workySyncQueue.add('worky-sync', { tenantId })
  return job.id!
}

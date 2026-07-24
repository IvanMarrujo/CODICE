// ============================================================
// CÓDICE · Odoo sync queue (BullMQ, in-process)
// Job on-demand (no repetible) — mismo patrón que zohoSyncQueue.ts /
// mondaySyncQueue.ts: cola propia para no tocar el dispatch de tipos de
// job de autoSyncQueue.ts.
// ============================================================

import { Queue, Worker, Job } from 'bullmq'
import { getTenantPrisma }    from '../middleware/tenant'
import { prismaPublic }       from '../lib/prisma'

const QUEUE_NAME = 'odoo-sync'

const redisUrl = new URL(process.env.REDIS_URL || 'redis://localhost:6379')
const connection = {
  host:                 redisUrl.hostname,
  port:                 Number(redisUrl.port) || 6379,
  password:             redisUrl.password || undefined,
  maxRetriesPerRequest: null as null,
}

export const odooSyncQueue = new Queue(QUEUE_NAME, { connection })

interface OdooSyncJobData {
  tenantId: string
}

type SyncFn = (tenantId: string, tenantDb: any, io: any) => Promise<unknown>

let worker: Worker<OdooSyncJobData> | null = null

export function startOdooSyncWorker(io: any, runSync: SyncFn): Worker<OdooSyncJobData> {
  if (worker) return worker

  worker = new Worker<OdooSyncJobData>(
    QUEUE_NAME,
    async (job: Job<OdooSyncJobData>) => {
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
    console.error(`❌  job "odoo-sync" falló (tenant ${job?.data.tenantId}):`, err.message)
    io?.to(`tenant:${job?.data.tenantId}`).emit('sync:error', {
      sourceType: 'ODOO',
      error:      job?.failedReason || err.message,
    })
  })

  return worker
}

export async function queueOdooSync(tenantId: string): Promise<string> {
  const job = await odooSyncQueue.add('odoo-sync', { tenantId })
  return job.id!
}

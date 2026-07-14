// ============================================================
// CÓDICE · Sync service
// Crea y actualiza SyncLog (schema público) para conectores
// (Excel, CONTPAQ, NOMIPAQ, ...).
// ============================================================

import { SyncLog, SyncSource } from '@prisma/client'
import { prismaPublic }        from '../lib/prisma'

export interface SyncRowError {
  row:     number
  message: string
  file?:   string
}

/** Crea el SyncLog inicial (status PENDING, según default del schema) — "start". */
export async function createSyncLog(tenantId: string, source: SyncSource, totalRows: number): Promise<SyncLog> {
  return prismaPublic.syncLog.create({
    data: { tenantId, source, totalRows },
  })
}

/** Marca el SyncLog como en curso — "running". */
export async function markSyncRunning(syncLogId: string): Promise<SyncLog> {
  return prismaPublic.syncLog.update({
    where: { id: syncLogId },
    data:  { status: 'RUNNING' },
  })
}

/** Cierra el SyncLog como completed/partial/failed según el resultado. */
export async function finishSync(
  syncLogId: string,
  opts: { processed: number; errors: SyncRowError[]; employeesProcessed?: number; payrollProcessed?: number }
): Promise<SyncLog> {
  const log = await prismaPublic.syncLog.findUniqueOrThrow({ where: { id: syncLogId } })
  const durationMs = Date.now() - log.startedAt.getTime()

  const status =
    opts.errors.length === 0             ? 'COMPLETED' :
    opts.processed > opts.errors.length  ? 'PARTIAL'   :
                                            'FAILED'

  return prismaPublic.syncLog.update({
    where: { id: syncLogId },
    data: {
      status,
      processed:          opts.processed,
      errors:             opts.errors.length,
      errorLog:           opts.errors as any,
      finishedAt:         new Date(),
      durationMs,
      employeesProcessed: opts.employeesProcessed,
      payrollProcessed:   opts.payrollProcessed,
    },
  })
}

/** Cierra el SyncLog como failed por un error catastrófico (no de fila). */
export async function failSync(syncLogId: string, message: string): Promise<SyncLog> {
  const log = await prismaPublic.syncLog.findUniqueOrThrow({ where: { id: syncLogId } })
  const durationMs = Date.now() - log.startedAt.getTime()

  return prismaPublic.syncLog.update({
    where: { id: syncLogId },
    data: {
      status:     'FAILED',
      errorLog:   [{ row: 0, message }] as any,
      finishedAt: new Date(),
      durationMs,
    },
  })
}

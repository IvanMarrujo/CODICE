// ============================================================
// CÓDICE · Sync emitter
// Punto único de propagación Socket.io cuando termina un ETL —
// lo usan runReloadForSource (reload manual, reemplazo de archivo,
// auto-sync programado) y el job 'webhook-sync' (agente/Nomipaq).
//
// `io` se registra una sola vez desde index.ts vía setIO() — este
// módulo NO importa de index.ts ni de routes/connectors.ts para
// evitar un import circular (ver autoSyncQueue.ts, mismo patrón).
// ============================================================

import type { Server } from 'socket.io'
import { redis } from './redis'
import { autoSyncQueue } from '../jobs/autoSyncQueue'
import type { SyncResult } from '../routes/connectors'

let ioInstance: Server | null = null

export function setIO(io: Server): void {
  ioInstance = io
}

export function getIO(): Server | null {
  return ioInstance
}

export async function emitSyncComplete(tenantId: string, result: SyncResult): Promise<void> {
  const io = getIO()

  // 1. Admin — mismo evento que ya escuchan ConnectedSourceCard/ModoAWizard.
  io?.to(`tenant:${tenantId}`).emit('sync:complete', {
    processed: result.processed,
    updated:   result.updated,
    errors:    result.errors,
    timestamp: new Date().toISOString(),
  })

  // 2. Cada colaborador afectado.
  for (const change of result.changedEmployees || []) {
    if (Math.abs((change.previousNetPay ?? change.newNetPay) - change.newNetPay) < 0.01) continue

    io?.to(`employee:${change.employeeId}`).emit('payroll:updated', {
      employeeId:   change.employeeId,
      period:       change.period,
      previousNeto: change.previousNetPay,
      newNeto:      change.newNetPay,
      diff:         change.previousNetPay != null ? change.newNetPay - change.previousNetPay : null,
      updatedAt:    new Date().toISOString(),
    })

    // El recibo cambió — la explicación de IA cacheada ya no aplica. Ya se
    // invalida dentro de upsertPayrollRecord también; repetirlo aquí es
    // barato (DEL de una key que probablemente ya no existe) y mantiene
    // este módulo correcto por sí solo si algún día lo llama otro caller.
    await redis.del(`t:${tenantId}:ai:payroll:${change.payrollRecordId}`)

    // Notificación in-app — encolada (no bloquea la respuesta del webhook)
    // en la misma cola de auto-sync; el worker inserta el registro real.
    const diff = change.previousNetPay != null ? change.newNetPay - change.previousNetPay : 0
    await autoSyncQueue.add('notify-employee', {
      tenantId,
      employeeId: change.employeeId,
      type:       'PAYROLL_UPDATED',
      title:      'Tu recibo ha sido actualizado',
      body:       diff > 0
        ? `Tu neto aumentó $${Math.abs(diff).toFixed(2)}`
        : `Tu neto cambió $${Math.abs(diff).toFixed(2)}`,
      link: '/mis-pagos',
    })
  }

  // 3. Headcount / widgets agregados del admin.
  io?.to(`tenant:${tenantId}`).emit('headcount:refresh', {})
}

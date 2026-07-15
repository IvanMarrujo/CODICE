// ============================================================
// CÓDICE · Digest diario 8am — cursos obligatorios pendientes
// Recorre todos los tenants activos y avisa al HR Manager de cada
// uno (WhatsApp) si hay colaboradores sin completar un curso
// obligatorio. Corre en el mismo proceso que la API (mismo patrón
// que jobs/autoSyncQueue.ts — no hay un proceso worker separado).
// ============================================================

import cron from 'node-cron'
import { prismaPublic } from '../lib/prisma'
import { getTenantPrisma } from '../middleware/tenant'
import { notifyHR } from '../lib/whatsapp'

async function checkTenant(tenantId: string, dbSchema: string): Promise<void> {
  const tenantDb = await getTenantPrisma(dbSchema)
  await tenantDb.$executeRawUnsafe(`SET search_path = "${dbSchema}", public`)

  const pending = await tenantDb.$queryRaw<{ title: string; pending: number }[]>`
    SELECT c.title, COUNT(*)::int AS pending FROM course_progress cp
    JOIN courses c ON c.id = cp.course_id
    WHERE cp.tenant_id = ${tenantId} AND c.tenant_id = ${tenantId} AND cp.passed = false AND c.is_mandatory = true
    GROUP BY c.title
  `

  for (const row of pending) {
    if (row.pending <= 0) continue
    notifyHR(
      tenantId, 'capacitacion',
      `📚 CÓDICE · Cursos pendientes\n${row.pending} colaboradores sin completar: ${row.title}`
    ) // fire-and-forget — ver notifyHR, nunca se espera aquí
  }
}

export function startDailyCourseDigest(): void {
  cron.schedule('0 8 * * *', async () => {
    try {
      const tenants = await prismaPublic.tenant.findMany({
        where:  { status: 'ACTIVE' },
        select: { id: true, dbSchema: true },
      })
      for (const t of tenants) {
        await checkTenant(t.id, t.dbSchema).catch((err) =>
          console.error(`❌  dailyCourseDigest falló para tenant ${t.id}:`, err.message)
        )
      }
    } catch (err: any) {
      console.error('❌  dailyCourseDigest falló:', err.message)
    }
  }, { timezone: 'America/Mexico_City' })
}

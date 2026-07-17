// ============================================================
// CÓDICE · Gamificación diaria 23:55 — asistencia, racha, XP
// Recorre todos los tenants activos y liquida el día para cada
// colaborador activo: si asistió hoy (hay attendance_records) suma
// racha + DAILY_ATTENDANCE; si no, reinicia la racha a 0. Corre en
// el mismo proceso que la API (mismo patrón que jobs/dailyCourseDigest.ts
// — no hay un proceso worker separado).
//
// Idempotente frente al webhook de ZKTeco (ver routes/zktecoWebhook.ts),
// que ya otorga DAILY_ATTENDANCE en tiempo real al primer check-in del
// día: este job solo otorga el XP si todavía no existe un xp_event de
// hoy para ese colaborador — así nunca se duplica, pase por donde pase
// el check-in (manual, ZKTeco, o ninguno).
// ============================================================

import cron from 'node-cron'
import { prismaPublic } from '../lib/prisma'
import { getTenantPrisma } from '../middleware/tenant'
import { awardXP, updateStreak, resetStreak } from '../lib/gamification'

async function settleTenant(tenantId: string, dbSchema: string): Promise<void> {
  const tenantDb = await getTenantPrisma(dbSchema)
  await tenantDb.$executeRawUnsafe(`SET search_path = "${dbSchema}", public`)

  const rows = await tenantDb.$queryRaw<{ employee_id: string; attended: boolean; already_awarded: boolean }[]>`
    SELECT
      e.id AS employee_id,
      (a.id IS NOT NULL) AS attended,
      (x.id IS NOT NULL) AS already_awarded
    FROM employees e
    LEFT JOIN attendance_records a
      ON a.employee_id = e.id AND a.tenant_id = e.tenant_id AND a.check_in_at::date = CURRENT_DATE
    LEFT JOIN xp_events x
      ON x.employee_id = e.id AND x.type = 'DAILY_ATTENDANCE' AND x.created_at::date = CURRENT_DATE
    WHERE e.tenant_id = ${tenantId} AND e.status = 'Activo'
  `

  for (const row of rows) {
    try {
      if (row.attended) {
        await updateStreak(tenantDb, tenantId, row.employee_id)
        if (!row.already_awarded) {
          await awardXP(tenantDb, tenantId, row.employee_id, 'DAILY_ATTENDANCE', 'Asistencia del día')
        }
      } else {
        await resetStreak(tenantDb, tenantId, row.employee_id)
      }
    } catch (err: any) {
      console.error(`❌  gamificationDaily falló para empleado ${row.employee_id}:`, err.message)
    }
  }
}

export function startGamificationDaily(): void {
  cron.schedule('55 23 * * *', async () => {
    try {
      const tenants = await prismaPublic.tenant.findMany({
        where:  { status: 'ACTIVE' },
        select: { id: true, dbSchema: true },
      })
      for (const t of tenants) {
        await settleTenant(t.id, t.dbSchema).catch((err) =>
          console.error(`❌  gamificationDaily falló para tenant ${t.id}:`, err.message)
        )
      }
    } catch (err: any) {
      console.error('❌  gamificationDaily falló:', err.message)
    }
  }, { timezone: 'America/Mexico_City' })
}

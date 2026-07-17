// ============================================================
// CÓDICE · Gamificación — XP, niveles, rachas y logros
// Punto único de otorgamiento de XP. Cualquier evento que deba dar
// puntos (asistencia, cursos, solicitudes, reconocimientos) pasa por
// awardXP() para mantener consistentes xp_points/xp_level/badges y
// emitir 'xp:earned' por Socket.io (getIO(), ver lib/syncEmitter.ts —
// mismo patrón para llamarse desde webhooks/jobs sin req/app).
// `employees.xp_points/xp_level/streak_days/streak_last_date/badges`
// viven en el schema desde el inicio — este módulo es quien los escribe.
// ============================================================

import { getIO } from './syncEmitter'

export type XpEventType =
  | 'DAILY_ATTENDANCE'
  | 'COURSE_COMPLETED'
  | 'REQUEST_RESOLVED'
  | 'RECOGNITION_RECEIVED'
  | 'STREAK_7_DAYS'
  | 'STREAK_30_DAYS'
  | 'STREAK_100_DAYS'

export const XP_RULES: Record<XpEventType, number> = {
  DAILY_ATTENDANCE:      10,
  COURSE_COMPLETED:      50,
  REQUEST_RESOLVED:      25,
  RECOGNITION_RECEIVED:  15,
  STREAK_7_DAYS:         25,
  STREAK_30_DAYS:        100,
  STREAK_100_DAYS:       500,
}

type LevelUnlock = { type: 'course' | 'badge'; id: string } | null

export const LEVELS = [
  { level: 1, min: 0,    max: 99,       label: 'Inicio',    unlock: null as LevelUnlock },
  { level: 2, min: 100,  max: 249,      label: 'Aprendiz',  unlock: { type: 'course', id: 'curso_basico' } as LevelUnlock },
  { level: 3, min: 250,  max: 499,      label: 'Constante', unlock: { type: 'badge', id: 'constante' } as LevelUnlock },
  { level: 4, min: 500,  max: 999,      label: 'Avanzado',  unlock: { type: 'course', id: 'curso_avanzado' } as LevelUnlock },
  { level: 5, min: 1000, max: Infinity, label: 'Élite',     unlock: { type: 'badge', id: 'elite' } as LevelUnlock },
]

export const BADGES = [
  { id: 'puntual',   emoji: '🎯', label: 'Puntual' },
  { id: 'aprendiz',  emoji: '📚', label: 'Aprendiz' },
  { id: 'constante', emoji: '💪', label: 'Constante' },
  { id: 'destacado', emoji: '⭐', label: 'Destacado' },
  { id: 'elite',     emoji: '👑', label: 'Élite' },
]

export function calculateLevel(xpTotal: number) {
  const current = LEVELS.find((l) => xpTotal >= l.min && xpTotal <= l.max) || LEVELS[LEVELS.length - 1]
  const next = LEVELS.find((l) => l.level === current.level + 1) || null
  const xpToNext = next ? Math.max(0, next.min - xpTotal) : 0
  const progressPct = next
    ? Math.min(100, Math.max(0, ((xpTotal - current.min) / (next.min - current.min)) * 100))
    : 100
  return { level: current.level, label: current.label, min: current.min, max: current.max, next, xpToNext, progressPct }
}

export function unlockedCourses(xpLevel: number): string[] {
  return LEVELS
    .filter((l) => l.level <= xpLevel && l.unlock?.type === 'course')
    .map((l) => l.unlock!.id)
}

async function checkBadgeConditions(
  tenantDb: any,
  employeeId: string,
  xpLevel: number,
  streakDays: number
): Promise<string[]> {
  const earned: string[] = []
  if (streakDays >= 30) earned.push('puntual')
  if (streakDays >= 100 || xpLevel >= 3) earned.push('constante')
  if (xpLevel >= 5) earned.push('elite')

  const [{ count: coursesCompleted }] = await tenantDb.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM course_progress WHERE employee_id = ${employeeId} AND passed = true
  `
  if (coursesCompleted > 0) earned.push('aprendiz')

  const [{ count: recognitions }] = await tenantDb.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM mentions WHERE employee_id = ${employeeId}
  `
  if (recognitions > 0) earned.push('destacado')

  return earned
}

// Fire-and-forget por diseño: nunca debe tumbar el flujo que la llama
// (checada ZKTeco, aprobación de solicitud, etc.) — errores solo se loguean.
export async function awardXP(
  tenantDb: any,
  tenantId: string,
  employeeId: string,
  type: XpEventType,
  description?: string
): Promise<void> {
  try {
    const xp = XP_RULES[type]

    await tenantDb.$executeRaw`
      INSERT INTO xp_events (employee_id, type, xp_earned, description)
      VALUES (${employeeId}, ${type}, ${xp}, ${description ?? null})
    `

    const rows = await tenantDb.$queryRaw<any[]>`
      UPDATE employees SET xp_points = xp_points + ${xp}
      WHERE id = ${employeeId} AND tenant_id = ${tenantId}
      RETURNING xp_points, xp_level, streak_days, badges
    `
    const employee = rows[0]
    if (!employee) return

    const { level: newLevel } = calculateLevel(employee.xp_points)
    const existingBadges: string[] = Array.isArray(employee.badges) ? employee.badges : []
    const earnedBadgeIds = await checkBadgeConditions(tenantDb, employeeId, newLevel, employee.streak_days)
    const newBadgeIds = earnedBadgeIds.filter((id) => !existingBadges.includes(id))
    const updatedBadges = newBadgeIds.length > 0 ? [...existingBadges, ...newBadgeIds] : existingBadges

    await tenantDb.$executeRaw`
      UPDATE employees SET xp_level = ${newLevel}, badges = ${JSON.stringify(updatedBadges)}::jsonb
      WHERE id = ${employeeId} AND tenant_id = ${tenantId}
    `

    getIO()?.to(`employee:${employeeId}`).emit('xp:earned', {
      xp,
      total: employee.xp_points,
      level: newLevel,
      newBadge: newBadgeIds[0] ?? null,
      streakDays: employee.streak_days,
    })
  } catch (err: any) {
    console.error(`⚠️  awardXP falló para empleado ${employeeId} (${type}):`, err.message)
  }
}

// Fire-and-forget — mismo criterio que awardXP.
export async function updateStreak(tenantDb: any, tenantId: string, employeeId: string): Promise<void> {
  try {
    const rows = await tenantDb.$queryRaw<any[]>`
      SELECT streak_days, streak_last_date FROM employees WHERE id = ${employeeId} AND tenant_id = ${tenantId}
    `
    const employee = rows[0]
    if (!employee) return

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' }) // YYYY-MM-DD
    const lastDate = employee.streak_last_date ? new Date(employee.streak_last_date).toISOString().slice(0, 10) : null

    if (lastDate === today) return // ya se contó hoy, evita doble incremento

    const yesterday = new Date(new Date(`${today}T12:00:00`).getTime() - 86400000).toISOString().slice(0, 10)
    const gapTooLarge = lastDate != null && lastDate !== yesterday
    const baseline = (lastDate == null || gapTooLarge) ? 0 : employee.streak_days
    const newStreak = baseline + 1

    await tenantDb.$executeRaw`
      UPDATE employees SET streak_days = ${newStreak}, streak_last_date = ${today}::date
      WHERE id = ${employeeId} AND tenant_id = ${tenantId}
    `

    if (newStreak === 7)   await awardXP(tenantDb, tenantId, employeeId, 'STREAK_7_DAYS',   'Bono racha 7 días')
    if (newStreak === 30)  await awardXP(tenantDb, tenantId, employeeId, 'STREAK_30_DAYS',  'Bono racha 30 días')
    if (newStreak === 100) await awardXP(tenantDb, tenantId, employeeId, 'STREAK_100_DAYS', 'Bono racha 100 días')
  } catch (err: any) {
    console.error(`⚠️  updateStreak falló para empleado ${employeeId}:`, err.message)
  }
}

export async function resetStreak(tenantDb: any, tenantId: string, employeeId: string): Promise<void> {
  try {
    await tenantDb.$executeRaw`
      UPDATE employees SET streak_days = 0 WHERE id = ${employeeId} AND tenant_id = ${tenantId}
    `
  } catch (err: any) {
    console.error(`⚠️  resetStreak falló para empleado ${employeeId}:`, err.message)
  }
}

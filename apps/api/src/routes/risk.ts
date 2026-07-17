// ============================================================
// CÓDICE · Motor de riesgo de salud
// GET  /api/employees/risk-summary            (requireHR)
// POST /api/employees/risk-summary/narrative  (requireHR)
//
// Referencial — no sustituye evaluación médica profesional.
// Nota de cumplimiento: el factor EDAD + ANTIGÜEDAD e INCAPACIDADES
// usa características protegidas por la LFT/NOM-035 (edad, licencia
// médica IMSS). Este endpoint es solo de lectura para RH y no debe
// alimentar decisiones de despido/no-renovación sin revisión legal.
//
// req.tenantDb ya tiene el search_path apuntando al tenant.
// ============================================================

import { Router, Request, Response, NextFunction } from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { requireHR } from '../middleware/auth'
import { redis } from '../lib/redis'
import { examFrequencyMonths } from '../data/occupational-risk-kb'

const router = Router()

const RISK_SUMMARY_TTL   = 60 * 60       // 1h
const RISK_NARRATIVE_TTL = 60 * 60 * 24  // 24h

function riskCacheKey(tenantId: string) { return `t:${tenantId}:risk:summary` }
function narrativeCacheKey(tenantId: string) { return `t:${tenantId}:risk:narrative` }

// Se llama desde los write-paths que sí existen hoy (attendance checkin/checkout,
// health PATCH/upload). `time_off` todavía no tiene endpoints de escritura en
// este repo (ver nota en computeRiskSummary) — cuando se agreguen, deben
// invalidar esta misma key.
export async function invalidateRiskCache(tenantId: string) {
  await redis.del(riskCacheKey(tenantId))
}

// ── CURP → edad ─────────────────────────────────────────────
// Posiciones 5-10 (1-indexed) = AAMMDD de nacimiento. El siglo se infiere
// del carácter diferenciador en la posición 17: dígito = 1900s, letra = 2000s
// (regla estándar RENAPO para CURPs con homoclave posterior a la reasignación).
function ageFromCurp(curp: string | null | undefined): number | null {
  if (!curp || curp.length < 18) return null
  const yy = curp.slice(4, 6)
  const mm = curp.slice(6, 8)
  const dd = curp.slice(8, 10)
  if (!/^\d{2}$/.test(yy) || !/^\d{2}$/.test(mm) || !/^\d{2}$/.test(dd)) return null

  const century = /[A-Z]/i.test(curp[16]) ? 2000 : 1900
  const birth = new Date(Date.UTC(century + parseInt(yy, 10), parseInt(mm, 10) - 1, parseInt(dd, 10)))
  if (isNaN(birth.getTime())) return null

  const now = new Date()
  let age = now.getUTCFullYear() - birth.getUTCFullYear()
  const monthDiff = now.getUTCMonth() - birth.getUTCMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < birth.getUTCDate())) age--
  return age >= 0 && age < 120 ? age : null
}

function antiguedadYears(hireDate: Date | string | null): number {
  if (!hireDate) return 0
  const d = new Date(hireDate)
  const now = new Date()
  let years = now.getFullYear() - d.getFullYear()
  const m = now.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) years--
  return Math.max(0, years)
}

// ── Puntajes por factor ──────────────────────────────────────

function ausentismoPts(n: number): number {
  if (n <= 0) return 0
  if (n <= 2) return 20
  if (n <= 4) return 60
  return 100
}
function incapacidadPts(n: number): number {
  if (n <= 0) return 0
  if (n === 1) return 30
  if (n === 2) return 70
  return 100
}
function condicionesPts(n: number, urgente: boolean): number {
  if (urgente) return 100
  if (n <= 0) return 0
  if (n <= 2) return 30
  return 70
}
function edadAntiguedadPts(age: number | null, antiguedad: number): number {
  let pts = 0
  if (age != null) {
    if (age > 60) pts = 80
    else if (age > 50) pts = 40
  }
  if (antiguedad > 15) pts += 20
  return Math.min(100, pts)
}

// ── Cruce con perfil de riesgo por departamento (CÓDICE Radar) ────

function normalizeCondition(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/_/g, ' ').trim()
}

function matchesIncompatibleCondition(declared: unknown[], incompatibles: string[]): boolean {
  if (!incompatibles.length || !declared.length) return false
  const normDeclared = declared.filter((d): d is string => typeof d === 'string').map(normalizeCondition)
  const normIncomp = incompatibles.map(normalizeCondition)
  return normIncomp.some((inc) => normDeclared.some((d) => d.includes(inc) || inc.includes(d)))
}

function monthsSince(dateStr: string | Date | null | undefined): number | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  const now = new Date()
  return (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth())
}

const WEIGHTS = { ausentismo: 0.4, incapacidad: 0.3, condiciones: 0.2, edad: 0.1 }

function levelFor(score: number): 'BAJO' | 'MEDIO' | 'ALTO' {
  if (score <= 30) return 'BAJO'
  if (score <= 60) return 'MEDIO'
  return 'ALTO'
}

interface EmployeeRisk {
  employeeId: string
  fullName: string
  department: string
  score: number
  level: 'BAJO' | 'MEDIO' | 'ALTO'
  factors: string[]
  urgente: boolean
  incapacidades: number
}

// ── Cálculo del resumen (sin cache) ───────────────────────────
// `time_off` existe en el schema del tenant pero ningún endpoint de este
// repo escribe en ella todavía (ni requests.ts ni connectors.ts la tocan) —
// ausentismo/incapacidades saldrán en 0 hasta que se implemente esa carga.
// `attendance_records` tampoco tiene columna `type`/historial más allá del
// día actual (es un mock de checador, ver attendance.ts), así que no se usa
// como segunda fuente de ausentismo: contar "días sin check-in" ahí sería
// ruido constante, no señal real.

async function computeRiskSummary(tenantDb: any, tenantId: string) {
  const employees = await tenantDb.$queryRaw<any[]>`
    SELECT id, full_name, department, curp, hire_date
    FROM employees
    WHERE tenant_id = ${tenantId} AND status != 'Baja'
  `

  const ausentismoRows = await tenantDb.$queryRaw<{ employee_id: string; n: number }[]>`
    SELECT employee_id, COUNT(*)::int AS n
    FROM time_off
    WHERE tenant_id = ${tenantId} AND type != 'Vacaciones'
      AND start_date >= CURRENT_DATE - INTERVAL '90 days'
    GROUP BY employee_id
  `
  const incapacidadRows = await tenantDb.$queryRaw<{ employee_id: string; n: number }[]>`
    SELECT employee_id, COUNT(*)::int AS n
    FROM time_off
    WHERE tenant_id = ${tenantId} AND type = 'Incapacidad IMSS'
      AND start_date >= CURRENT_DATE - INTERVAL '180 days'
    GROUP BY employee_id
  `
  const healthRows = await tenantDb.$queryRaw<any[]>`
    SELECT employee_id, condiciones_declaradas, documentos, fecha_ultimo_examen
    FROM health_profiles
    WHERE tenant_id = ${tenantId}
  `
  // CÓDICE Radar — perfil de riesgo por departamento (Part 6: hace el
  // score dept-específico en vez de genérico). Sin fila para un depto ==
  // sin ajuste (mismo resultado que antes de este feature).
  // Tolerante a que la tabla todavía no exista en este tenant (deploy antes
  // de correr el backfill/seed) — degrada al comportamiento pre-Radar en
  // vez de tumbar /risk-summary, que ya tiene tráfico real.
  const deptProfileRows = await tenantDb.$queryRaw<any[]>`
    SELECT department, perfil_optimo, historial_accidentes
    FROM department_risk_profiles
    WHERE tenant_id = ${tenantId}
  `.catch((err: any) => {
    console.error('⚠️  department_risk_profiles no disponible todavía (¿falta el backfill?):', err.message)
    return [] as any[]
  })

  const ausentismoMap  = new Map<string, number>(ausentismoRows.map((r: any) => [r.employee_id, r.n]))
  const incapacidadMap = new Map<string, number>(incapacidadRows.map((r: any) => [r.employee_id, r.n]))
  const healthMap      = new Map<string, any>(healthRows.map((r: any) => [r.employee_id, r]))
  const deptProfileMap = new Map<string, any>(deptProfileRows.map((r: any) => [r.department, r]))

  const results: EmployeeRisk[] = employees.map((e: any) => {
    const ausN   = ausentismoMap.get(e.id) ?? 0
    const incapN = incapacidadMap.get(e.id) ?? 0
    const health = healthMap.get(e.id)
    const condiciones: unknown[] = health?.condiciones_declaradas ?? []
    const documentos: any[]      = health?.documentos ?? []
    const urgente = documentos.some(
      (d: any) => d.status === 'ready' && Array.isArray(d.insights) && d.insights.some((i: any) => i.nivel === 'urgente')
    )
    const age = ageFromCurp(e.curp)
    const antiguedad = antiguedadYears(e.hire_date)

    const deptProfile = deptProfileMap.get(e.department)
    const perfilOptimo = deptProfile?.perfil_optimo ?? {}
    const condicionesIncompatibles: string[] = perfilOptimo.condicionesIncompatibles ?? []
    const incompatibleMatch = matchesIncompatibleCondition(condiciones, condicionesIncompatibles)
    const mesesDesdeExamen = monthsSince(health?.fecha_ultimo_examen)
    const examOverdue = mesesDesdeExamen != null && mesesDesdeExamen > examFrequencyMonths(perfilOptimo.examenRequerido)
    const accidentesRecientesDept = (deptProfile?.historial_accidentes ?? []).filter((a: any) => {
      const m = monthsSince(a.fecha)
      return m != null && m <= 6
    }).length

    const pAus  = ausentismoPts(ausN)
    const pInc  = incapacidadPts(incapN)
    const pCond = condicionesPts(condiciones.length, urgente)
    const pEdad = edadAntiguedadPts(age, antiguedad)

    let score = Math.round(
      pAus * WEIGHTS.ausentismo + pInc * WEIGHTS.incapacidad + pCond * WEIGHTS.condiciones + pEdad * WEIGHTS.edad
    )
    if (incompatibleMatch) score += 40
    if (examOverdue) score += 20
    score = Math.min(100, score)
    const level = levelFor(score)

    const factors: string[] = []
    if (ausN > 0) factors.push(`${ausN} ausencia${ausN === 1 ? '' : 's'} (90 días)`)
    if (incapN > 0) factors.push(`${incapN} incapacidad${incapN === 1 ? '' : 'es'} IMSS`)
    if (urgente) factors.push('hallazgo médico urgente')
    else if (condiciones.length > 0) factors.push(`${condiciones.length} ${condiciones.length === 1 ? 'condición declarada' : 'condiciones declaradas'}`)
    if (incompatibleMatch) factors.push('condición incompatible con puesto')
    if (examOverdue) factors.push('examen vencido')
    if (age != null && age > 50) factors.push(`${age} años`)
    if (antiguedad > 15) factors.push(`${antiguedad} años de antigüedad`)
    if (accidentesRecientesDept > 0) factors.push(`${accidentesRecientesDept} accidente${accidentesRecientesDept === 1 ? '' : 's'} reciente${accidentesRecientesDept === 1 ? '' : 's'} en el depto.`)

    return {
      employeeId: e.id,
      fullName:   e.full_name,
      department: e.department || 'Sin área',
      score,
      level,
      factors,
      urgente,
      incapacidades: incapN,
    }
  })

  const summary = { bajo: 0, medio: 0, alto: 0, total: results.length }
  for (const r of results) {
    if (r.level === 'BAJO') summary.bajo++
    else if (r.level === 'MEDIO') summary.medio++
    else summary.alto++
  }

  const byDeptMap = new Map<string, { department: string; alto: number; medio: number; bajo: number; scores: number[] }>()
  for (const r of results) {
    if (!byDeptMap.has(r.department)) {
      byDeptMap.set(r.department, { department: r.department, alto: 0, medio: 0, bajo: 0, scores: [] })
    }
    const d = byDeptMap.get(r.department)!
    if (r.level === 'ALTO') d.alto++
    else if (r.level === 'MEDIO') d.medio++
    else d.bajo++
    d.scores.push(r.score)
  }
  const byDepartment = Array.from(byDeptMap.values())
    .map((d) => ({
      department: d.department,
      alto: d.alto,
      medio: d.medio,
      bajo: d.bajo,
      avgScore: Math.round(d.scores.reduce((a, b) => a + b, 0) / d.scores.length),
    }))
    .sort((a, b) => (b.alto - a.alto) || (b.avgScore - a.avgScore))

  const topRisk = [...results]
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ employeeId, fullName, department, score, level, factors }) => ({ employeeId, fullName, department, score, level, factors }))

  const alerts = results
    .filter((r) => r.level === 'ALTO')
    .sort((a, b) => b.score - a.score)
    .map((r) => ({
      employeeId: r.employeeId,
      fullName:   r.fullName,
      message: r.urgente
        ? `Hallazgo médico urgente detectado — score de riesgo ${r.score}/100`
        : `Nivel de riesgo alto (${r.score}/100)${r.factors.length ? ` — ${r.factors.slice(0, 2).join(', ')}` : ''}`,
      urgency: (r.urgente || r.incapacidades >= 3) ? 'alta' as const : 'media' as const,
    }))

  return { summary, byDepartment, topRisk, alerts }
}

// ── GET /api/employees/risk-summary ────────────────────────────

router.get('/risk-summary', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb

    const cached = await redis.get(riskCacheKey(tenantId))
    if (cached) return res.json(JSON.parse(cached))

    const data = await computeRiskSummary(tenantDb, tenantId)
    await redis.set(riskCacheKey(tenantId), JSON.stringify(data), 'EX', RISK_SUMMARY_TTL)
    res.json(data)
  } catch (err) {
    next(err)
  }
})

// ── POST /api/employees/risk-summary/narrative ─────────────────
// Bajo demanda (botón "Actualizar análisis" en el front) — no corre
// automáticamente por request, por eso no lleva límite diario como
// /api/ai/consult o el extractor de health.ts.

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const AI_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5'

router.post('/risk-summary/narrative', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb
    const forceRefresh = req.query.refresh === 'true'

    if (!forceRefresh) {
      const cachedNarrative = await redis.get(narrativeCacheKey(tenantId))
      if (cachedNarrative) return res.json({ narrative: cachedNarrative })
    }

    const cachedSummary = await redis.get(riskCacheKey(tenantId))
    const data = cachedSummary ? JSON.parse(cachedSummary) : await computeRiskSummary(tenantDb, tenantId)
    if (!cachedSummary) await redis.set(riskCacheKey(tenantId), JSON.stringify(data), 'EX', RISK_SUMMARY_TTL)

    const prompt = `Analiza este resumen de riesgo de salud de la plantilla de ${req.tenant.name} y genera un párrafo ejecutivo en español para el Director de RH.
Máximo 4 oraciones. Sin markdown. Datos concretos.
No menciones nombres de empleados individuales — solo tendencias.

Datos: ${JSON.stringify({ summary: data.summary, byDepartment: data.byDepartment, alertCount: data.alerts.length })}`

    const message = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    })
    const narrative = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim()

    await redis.set(narrativeCacheKey(tenantId), narrative, 'EX', RISK_NARRATIVE_TTL)
    res.json({ narrative })
  } catch (err) {
    next(err)
  }
})

export default router

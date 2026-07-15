// ============================================================
// CÓDICE · LFT calculators
// Cálculos puros de Ley Federal del Trabajo (México).
// Sin DB, sin auth — montadas antes del pipeline autenticado.
// ============================================================

import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { AppError } from '../lib/errors'
import { authMiddleware } from '../middleware/auth'
import { tenantMiddleware } from '../middleware/tenant'

const router = Router()

const round2 = (n: number) => Math.round(n * 100) / 100

// ── Tabla de vacaciones (reforma "vacaciones dignas", vigente desde 2023) ─
// Año 1: 12 días, +2 por año hasta el año 5 (20 días),
// luego +2 días cada bloque de 5 años adicionales.

function diasVacaciones(antiguedad: number): number {
  if (antiguedad <= 0) return 0
  if (antiguedad <= 5) return 12 + (antiguedad - 1) * 2
  const bloquesExtra = Math.ceil((antiguedad - 5) / 5)
  return 20 + bloquesExtra * 2
}

// ── Política interna de vacaciones (opcional, por tenant) ──────────────
// Siempre >= LFT — ver enforcement en /vacaciones y en PATCH /api/settings/vacation-policy.

interface VacationPolicy {
  year_1_days: number; year_2_days: number; year_3_days: number
  year_4_days: number; year_5_days: number; additional_days_per_5_years: number
  max_days: number
}

function diasPorPolitica(policy: VacationPolicy, antiguedad: number): number {
  if (antiguedad <= 0) return 0
  const tier = Math.floor(antiguedad)
  let dias: number
  if (tier === 1) dias = policy.year_1_days
  else if (tier === 2) dias = policy.year_2_days
  else if (tier === 3) dias = policy.year_3_days
  else if (tier === 4) dias = policy.year_4_days
  else {
    const bloquesExtra = Math.floor((tier - 5) / 5)
    dias = policy.year_5_days + bloquesExtra * policy.additional_days_per_5_years
  }
  return Math.min(dias, policy.max_days)
}

// Mínimos legales por tramo — usados para validar que una política interna
// nunca ofrezca menos que la ley (Art. 76 LFT, reforma "vacaciones dignas").
export const LFT_MINIMOS = {
  year_1_days: 12, year_2_days: 14, year_3_days: 16, year_4_days: 18, year_5_days: 20,
} as const

// ── Jornada laboral — calendario de reducción escalonada 2026-2030 ────

const JORNADA_SCHEDULE: Record<number, number> = { 2026: 48, 2027: 46, 2028: 44, 2029: 42, 2030: 40 }

function horasJornada(year: number): number {
  if (year in JORNADA_SCHEDULE) return JORNADA_SCHEDULE[year]
  if (year < 2026) return 48
  return 40 // 2031+ ya estabilizado en 40h
}

// ── Aguinaldo (Art. 87 LFT): mínimo 15 días de salario ────────────────

function calcAguinaldo(salarioMensual: number, diasTrabajados: number) {
  const salarioDiario     = salarioMensual / 30
  const aguinaldoCompleto = round2(salarioDiario * 15)
  const proporcional      = round2((salarioDiario * 15 / 365) * diasTrabajados)
  return { salarioDiario: round2(salarioDiario), aguinaldoCompleto, proporcional }
}

// ── Finiquito: partes proporcionales de aguinaldo + vacaciones + prima ─
// vacacional (Art. 76, 80, 87 LFT). diasTrabajados = días transcurridos
// del año/aniversario en curso, usados para prorratear.

function calcFiniquito(salarioMensual: number, antiguedad: number, diasTrabajados: number) {
  const salarioDiario = salarioMensual / 30
  const diasVac       = diasVacaciones(antiguedad)

  const vacacionesProporcional = round2(salarioDiario * diasVac * (diasTrabajados / 365))
  const primaVacacional        = round2(vacacionesProporcional * 0.25)          // mínimo 25%, Art. 80
  const aguinaldoProporcional  = round2((salarioDiario * 15 / 365) * diasTrabajados)

  const total = round2(vacacionesProporcional + primaVacacional + aguinaldoProporcional)

  return {
    salarioDiario:  round2(salarioDiario),
    diasVacaciones: diasVac,
    vacacionesProporcional,
    primaVacacional,
    aguinaldoProporcional,
    total,
  }
}

// ── GET /api/lft/vacaciones ────────────────────────────────────────────

const vacacionesSchema = z.object({
  antiguedad:  z.coerce.number().min(0),
  salarioBase: z.coerce.number().optional(),
})

// Requiere auth solo en esta ruta (las demás de este router son cálculos
// puros sin estado, sin tenant) — es la única que necesita saber si el
// tenant tiene una política interna configurada.
router.get('/vacaciones', authMiddleware, tenantMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { antiguedad, salarioBase } = vacacionesSchema.parse(req.query)
    const lftDias = diasVacaciones(antiguedad)

    let dias = lftDias
    let fuente: 'POLITICA_INTERNA' | 'LFT_2026' = 'LFT_2026'

    const policyRows = await req.tenantDb.$queryRaw<VacationPolicy[]>`
      SELECT year_1_days, year_2_days, year_3_days, year_4_days, year_5_days, additional_days_per_5_years, max_days
      FROM vacation_policy WHERE tenant_id = ${req.tenant.id} LIMIT 1
    `
    const policy = policyRows[0]
    if (policy) {
      dias = Math.max(diasPorPolitica(policy, antiguedad), lftDias) // nunca menos que la ley
      fuente = 'POLITICA_INTERNA'
    }

    const salarioDiario = salarioBase ? round2(salarioBase / 30) : undefined
    const primaVacacional = salarioDiario ? round2(salarioDiario * dias * 0.25) : undefined

    res.json({ antiguedad, dias, primaVacacional, fuente, salarioBase: salarioBase ?? null })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/lft/aguinaldo ──────────────────────────────────────────────

const aguinaldoSchema = z.object({
  salarioMensual: z.coerce.number().positive(),
  diasTrabajados: z.coerce.number().min(0).max(365).default(365),
})

router.get('/aguinaldo', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { salarioMensual, diasTrabajados } = aguinaldoSchema.parse(req.query)
    const { aguinaldoCompleto, proporcional } = calcAguinaldo(salarioMensual, diasTrabajados)
    res.json({ aguinaldoCompleto, proporcional })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/lft/finiquito ───────────────────────────────────────────────

const finiquitoSchema = z.object({
  salarioMensual: z.coerce.number().positive(),
  antiguedad:     z.coerce.number().min(0).default(0),
  diasTrabajados: z.coerce.number().min(0).max(365).default(365),
})

router.get('/finiquito', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { salarioMensual, antiguedad, diasTrabajados } = finiquitoSchema.parse(req.query)
    const breakdown = calcFiniquito(salarioMensual, antiguedad, diasTrabajados)
    res.json(breakdown)
  } catch (err) {
    next(err)
  }
})

// ── GET /api/lft/indemnizacion (despido injustificado, Art. 48-50, 162) ─

const indemnizacionSchema = z.object({
  salarioMensual: z.coerce.number().positive(),
  antiguedad:     z.coerce.number().min(0),
  salarioMinimo:  z.coerce.number().positive(), // salario mínimo diario vigente (zona geográfica)
})

router.get('/indemnizacion', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { salarioMensual, antiguedad, salarioMinimo } = indemnizacionSchema.parse(req.query)
    const salarioDiario = salarioMensual / 30

    const tresMeses = round2(salarioDiario * 90)
    const veinteDias = round2(salarioDiario * 20 * antiguedad)

    // Prima de antigüedad (Art. 162): 12 días por año, tope de 2 veces el salario mínimo.
    const primaAntiguedadDiario = Math.min(salarioDiario, salarioMinimo * 2)
    const primaAntiguedad = round2(primaAntiguedadDiario * 12 * antiguedad)

    const finiquito = calcFiniquito(salarioMensual, antiguedad, 365)
    const total = round2(tresMeses + veinteDias + primaAntiguedad + finiquito.total)

    res.json({ tresMeses, veinteDias, primaAntiguedad, finiquito, total })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/lft/jornada ────────────────────────────────────────────────

const jornadaSchema = z.object({ year: z.coerce.number().int().optional() })

router.get('/jornada', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { year } = jornadaSchema.parse(req.query)
    if (year) return res.json({ year, horas: horasJornada(year) })
    res.json({ schedule: JORNADA_SCHEDULE })
  } catch (err) {
    next(err)
  }
})

export default router

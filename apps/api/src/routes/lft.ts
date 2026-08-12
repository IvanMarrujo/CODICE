// ============================================================
// CÓDICE · LFT calculators
// Cálculos puros de Ley Federal del Trabajo (México).
// Sin DB, sin auth — montadas antes del pipeline autenticado.
// ============================================================

import { Router, Request, Response, NextFunction, RequestHandler } from 'express'
import { z } from 'zod'
import multer from 'multer'
import * as path from 'path'
import * as crypto from 'crypto'
import Anthropic from '@anthropic-ai/sdk'
import { AppError } from '../lib/errors'
import { authMiddleware, requireHR, requireEmployee } from '../middleware/auth'
import { tenantMiddleware } from '../middleware/tenant'
import { saveFile } from '../lib/storage'

const router = Router()

// Pipeline autenticado inline para las rutas de Feature 5 (este router se
// monta en la sección pública; las calculadoras de arriba no llevan auth,
// pero machotes/reglamento/separación sí tocan la DB del tenant).
const authed = [authMiddleware, tenantMiddleware] as const

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const AI_MODEL  = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5'

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

// ============================================================
// Feature 5 · MÓDULO LFT + CARTA DE SALIDA
// ============================================================

function stripJsonFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
}

const DOC_EXT = new Set(['.pdf', '.docx'])
const DOC_MIME: Record<string, string> = {
  '.pdf':  'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}
const docUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (!DOC_EXT.has(ext)) return cb(new AppError(400, 'Solo se aceptan PDF o DOCX'))
    cb(null, true)
  },
}).single('file')
function handleDocUpload(req: Request, res: Response, next: NextFunction) {
  (docUpload as RequestHandler)(req, res, (err: any) => {
    if (!err) return next()
    if (err instanceof multer.MulterError) {
      return next(new AppError(400, err.code === 'LIMIT_FILE_SIZE' ? 'El archivo supera 10MB' : err.message))
    }
    next(err)
  })
}

// ── REGLAMENTO INTERNO ───────────────────────────────────────
// POST sube y fija el reglamento a nivel tenant; GET lo expone (también al
// colaborador, para reflejarlo en Avisos del EmpleadoShell).

router.post('/reglamento', ...authed, requireHR, handleDocUpload, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const file = req.file as Express.Multer.File | undefined
    if (!file) throw new AppError(400, 'No se subió ningún archivo')
    const ext = path.extname(file.originalname).toLowerCase()
    const key = `${tenantId}/reglamento_interno${ext}`
    await saveFile(key, file.buffer, DOC_MIME[ext] || file.mimetype, 'tenant-docs')

    const rows = await req.tenantDb.$queryRaw<any[]>`
      INSERT INTO tenant_documents (tenant_id, type, nombre, archivo_url, mime_type, uploaded_by)
      VALUES (${tenantId}, 'reglamento_interno', ${file.originalname}, ${key}, ${DOC_MIME[ext] || file.mimetype}, ${req.jwt.email})
      ON CONFLICT (tenant_id, type) DO UPDATE
        SET nombre = EXCLUDED.nombre, archivo_url = EXCLUDED.archivo_url,
            mime_type = EXCLUDED.mime_type, uploaded_by = EXCLUDED.uploaded_by, created_at = NOW()
      RETURNING *
    `
    res.status(201).json({ document: rows[0] })
  } catch (err) {
    next(err)
  }
})

router.get('/reglamento', ...authed, requireEmployee, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await req.tenantDb.$queryRaw<any[]>`
      SELECT * FROM tenant_documents WHERE tenant_id = ${req.tenant.id} AND type = 'reglamento_interno' LIMIT 1
    `
    res.json({ document: rows[0] || null })
  } catch (err) {
    next(err)
  }
})

// ── MACHOTES DE CARTA DE SALIDA (exit_letter_templates) ──────

const EXIT_SYSTEM_PROMPT = `Eres experto en derecho laboral mexicano. Analiza esta carta de salida/machote y extrae:
- Tipo (renuncia | despido_justificado | despido_injustificado | mutuo_acuerdo)
- Disposiciones o cláusulas especiales (lista)
- Campos variables (ej: {NOMBRE}, {FECHA})
Responde ONLY JSON:
{ "tipo": string, "disposicionesEspeciales": string[], "camposVariables": string[], "resumen": string }`

async function analyzeExitLetter(buffer: Buffer, ext: string, filename: string) {
  if (ext !== '.pdf') return null
  const resp = await anthropic.beta.messages.create({
    model: AI_MODEL,
    max_tokens: 1200,
    system: EXIT_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } },
        { type: 'text', text: `Analiza esta carta de salida: ${filename}` },
      ],
    }],
  })
  const block = resp.content.find((b: any) => b.type === 'text') as { text: string } | undefined
  if (!block) return null
  try { return JSON.parse(stripJsonFences(block.text)) } catch { return null }
}

router.post('/exit-letters/upload', ...authed, requireHR, handleDocUpload, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const file = req.file as Express.Multer.File | undefined
    if (!file) throw new AppError(400, 'No se subió ningún archivo')
    const ext = path.extname(file.originalname).toLowerCase()
    const key = `${tenantId}/exit/${crypto.randomUUID()}${ext}`
    await saveFile(key, file.buffer, DOC_MIME[ext] || file.mimetype, 'exit-letters')

    let analysis: any = null
    try { analysis = await analyzeExitLetter(file.buffer, ext, file.originalname) }
    catch (e: any) { console.error('[lft] análisis carta salida falló:', e.message) }

    const rows = await req.tenantDb.$queryRaw<any[]>`
      INSERT INTO exit_letter_templates (tenant_id, nombre, tipo, disposiciones, archivo_url, ia_analysis, created_by)
      VALUES (${tenantId}, ${file.originalname.replace(/\.(pdf|docx)$/i, '')}, ${analysis?.tipo || null},
              ${(analysis?.disposicionesEspeciales || []).join('\n') || null}, ${key},
              ${analysis ? JSON.stringify(analysis) : null}::jsonb, ${req.jwt.email})
      RETURNING *
    `
    res.status(201).json({ template: rows[0], analyzed: !!analysis })
  } catch (err) {
    next(err)
  }
})

router.get('/exit-letters', ...authed, requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await req.tenantDb.$queryRaw<any[]>`
      SELECT * FROM exit_letter_templates WHERE tenant_id = ${req.tenant.id} ORDER BY created_at DESC
    `
    res.json({ templates: rows })
  } catch (err) {
    next(err)
  }
})

const exitPatchSchema = z.object({
  nombre:        z.string().min(1).optional(),
  tipo:          z.enum(['renuncia', 'despido_justificado', 'despido_injustificado', 'mutuo_acuerdo']).optional(),
  disposiciones: z.string().optional(),
})

router.patch('/exit-letters/:id', ...authed, requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = exitPatchSchema.parse(req.body)
    const rows = await req.tenantDb.$queryRaw<any[]>`
      UPDATE exit_letter_templates SET
        nombre        = COALESCE(${input.nombre ?? null}, nombre),
        tipo          = COALESCE(${input.tipo ?? null}, tipo),
        disposiciones = COALESCE(${input.disposiciones ?? null}, disposiciones)
      WHERE id = ${req.params.id} AND tenant_id = ${req.tenant.id}
      RETURNING *
    `
    if (!rows[0]) throw new AppError(404, 'Machote no encontrado')
    res.json({ template: rows[0] })
  } catch (err) {
    next(err)
  }
})

router.delete('/exit-letters/:id', ...authed, requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await req.tenantDb.$queryRaw<any[]>`
      DELETE FROM exit_letter_templates WHERE id = ${req.params.id} AND tenant_id = ${req.tenant.id} RETURNING id
    `
    if (!rows[0]) throw new AppError(404, 'Machote no encontrado')
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// ── PROCESO DE SEPARACIÓN (wizard "lanzar un misil") ─────────

// Cálculo completo del finiquito/liquidación por tipo de separación.
// Reusa las calculadoras puras de arriba y añade indemnización y descuentos.
const separationCalcSchema = z.object({
  tipo:           z.enum(['renuncia', 'despido_justificado', 'despido_injustificado', 'mutuo_acuerdo', 'jubilacion']),
  salarioMensual: z.coerce.number().positive(),
  antiguedad:     z.coerce.number().min(0),
  diasTrabajados: z.coerce.number().min(0).max(365).default(365),
  salarioMinimo:  z.coerce.number().positive().default(278.80), // SM diario general 2025 (ajustable)
  prestamosPendientes: z.coerce.number().min(0).default(0),
})

function calcSeparacion(input: z.infer<typeof separationCalcSchema>) {
  const { tipo, salarioMensual, antiguedad, diasTrabajados, salarioMinimo, prestamosPendientes } = input
  const salarioDiario = salarioMensual / 30
  const finiquito = calcFiniquito(salarioMensual, antiguedad, diasTrabajados)

  const conceptos: { concepto: string; articulo: string; monto: number }[] = [
    { concepto: 'Vacaciones proporcionales', articulo: 'Art. 76 LFT', monto: finiquito.vacacionesProporcional },
    { concepto: 'Prima vacacional (25%)',    articulo: 'Art. 80 LFT', monto: finiquito.primaVacacional },
    { concepto: 'Aguinaldo proporcional',    articulo: 'Art. 87 LFT', monto: finiquito.aguinaldoProporcional },
  ]

  // Prima de antigüedad (Art. 162): 12 días/año, tope 2x salario mínimo.
  // Aplica en renuncia con 15+ años, y en despidos/jubilación.
  const primaAntiguedadAplica =
    tipo === 'despido_justificado' || tipo === 'despido_injustificado' ||
    tipo === 'jubilacion' || tipo === 'mutuo_acuerdo' ||
    (tipo === 'renuncia' && antiguedad >= 15)
  let primaAntiguedad = 0
  if (primaAntiguedadAplica) {
    const primaDiario = Math.min(salarioDiario, salarioMinimo * 2)
    primaAntiguedad = round2(primaDiario * 12 * antiguedad)
    conceptos.push({ concepto: 'Prima de antigüedad', articulo: 'Art. 162 LFT', monto: primaAntiguedad })
  }

  // Indemnización constitucional (despido injustificado): 3 meses + 20 días/año.
  let indemnizacion = 0
  if (tipo === 'despido_injustificado') {
    const tresMeses = round2(salarioDiario * 90)
    const veinteDias = round2(salarioDiario * 20 * antiguedad)
    indemnizacion = round2(tresMeses + veinteDias)
    conceptos.push({ concepto: 'Indemnización 3 meses', articulo: 'Art. 48 LFT', monto: tresMeses })
    conceptos.push({ concepto: 'Indemnización 20 días/año', articulo: 'Art. 50 LFT', monto: veinteDias })
  }

  const subtotal = round2(conceptos.reduce((a, c) => a + c.monto, 0))
  const descuentos = round2(prestamosPendientes)
  const total = round2(subtotal - descuentos)

  return {
    tipo, salarioDiario: round2(salarioDiario), diasVacaciones: finiquito.diasVacaciones,
    conceptos, subtotal,
    descuentos: [{ concepto: 'Préstamos pendientes', monto: descuentos }],
    totalFiniquito: total,
    incluyeIndemnizacion: indemnizacion > 0,
  }
}

router.post('/separation/calcular', ...authed, requireHR, (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = separationCalcSchema.parse(req.body)
    res.json(calcSeparacion(input))
  } catch (err) {
    next(err)
  }
})

// Crea el expediente de separación con folio legible.
const separationCreateSchema = z.object({
  employeeId: z.string().min(1),
  tipo:       z.enum(['renuncia', 'despido_justificado', 'despido_injustificado', 'mutuo_acuerdo', 'jubilacion']),
  respuestas: z.record(z.string(), z.any()).optional().default({}),
  calculo:    z.record(z.string(), z.any()).optional().default({}),
  documentos: z.array(z.any()).optional().default([]),
})

router.post('/separation', ...authed, requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = separationCreateSchema.parse(req.body)
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb
    const year = new Date().getFullYear()

    const prefix = String(req.tenant.slug || req.tenant.name || 'ORG').replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() || 'ORG'
    const countRows = await tenantDb.$queryRaw<any[]>`
      SELECT COUNT(*)::int AS n FROM separation_processes
      WHERE tenant_id = ${tenantId} AND EXTRACT(YEAR FROM created_at) = ${year}
    `
    const seq = String((countRows[0]?.n || 0) + 1).padStart(4, '0')
    const folio = `${prefix}-${year}-SEP-${seq}`

    const rows = await tenantDb.$queryRaw<any[]>`
      INSERT INTO separation_processes (tenant_id, folio, employee_id, tipo, respuestas, calculo, documentos, created_by, status)
      VALUES (${tenantId}, ${folio}, ${input.employeeId}, ${input.tipo},
              ${JSON.stringify(input.respuestas)}::jsonb, ${JSON.stringify(input.calculo)}::jsonb,
              ${JSON.stringify(input.documentos)}::jsonb, ${req.jwt.email}, 'Iniciado')
      RETURNING *
    `
    res.status(201).json({ process: rows[0] })
  } catch (err) {
    next(err)
  }
})

router.get('/separation/:id', ...authed, requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await req.tenantDb.$queryRaw<any[]>`
      SELECT * FROM separation_processes WHERE id = ${req.params.id} AND tenant_id = ${req.tenant.id} LIMIT 1
    `
    if (!rows[0]) throw new AppError(404, 'Proceso no encontrado')
    res.json({ process: rows[0] })
  } catch (err) {
    next(err)
  }
})

export default router

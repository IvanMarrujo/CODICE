// ============================================================
// KODICE · Reportes al instante (Feature 6)
// Shell conversacional: una pregunta en lenguaje natural → un reporte.
// La IA (Claude) SOLO interpreta la intención hacia un spec acotado
// (metric + groupBy validados contra whitelist); las consultas SQL son
// parametrizadas y deterministas. El modelo nunca genera SQL.
// Montado detrás del pipeline autenticado (ver index.ts).
// ============================================================

import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'
import { requireHR } from '../middleware/auth'
import { AppError } from '../lib/errors'
import { redis } from '../lib/redis'

const router = Router()

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const AI_MODEL  = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5'
const DAILY_LIMIT = 100

router.get('/', (_req, res) => res.json({ route: 'reports', status: 'ok' }))

// ── Whitelists — la IA solo puede elegir de estos conjuntos ──────
// groupBy (dimensión) → columna real de employees.
const GROUP_COLS: Record<string, { col: string; label: string; plural: string }> = {
  department:    { col: 'department', label: 'Departamento', plural: 'Departamentos' },
  area:          { col: 'department', label: 'Área', plural: 'Áreas' },
  turno:         { col: 'shift',      label: 'Turno', plural: 'Turnos' },
  shift:         { col: 'shift',      label: 'Turno', plural: 'Turnos' },
  planta:        { col: 'plant',      label: 'Planta', plural: 'Plantas' },
  plant:         { col: 'plant',      label: 'Planta', plural: 'Plantas' },
  status:        { col: 'status',     label: 'Estatus', plural: 'Estatus' },
  estatus:       { col: 'status',     label: 'Estatus', plural: 'Estatus' },
  contrato:      { col: 'contract_type', label: 'Tipo de contrato', plural: 'Tipos de contrato' },
  contract_type: { col: 'contract_type', label: 'Tipo de contrato', plural: 'Tipos de contrato' },
}

// metric → expresión de agregación + etiqueta + formato.
const METRICS: Record<string, { expr: string; label: string; kind: 'count' | 'money' | 'years' }> = {
  headcount:  { expr: 'COUNT(*)::int',                                   label: 'Colaboradores', kind: 'count' },
  payroll:    { expr: 'COALESCE(SUM(monthly_salary), 0)::numeric',       label: 'Nómina mensual', kind: 'money' },
  seniority:  { expr: 'ROUND(AVG(COALESCE(seniority_years, 0))::numeric, 1)', label: 'Antigüedad promedio (años)', kind: 'years' },
}

const INTERPRET_SYSTEM = `Eres un motor de reportes de RH. Traduce la pregunta del usuario a un spec JSON acotado.
Dimensiones válidas (groupBy): department, turno, planta, status, contrato.
Métricas válidas (metric): headcount (conteo de empleados), payroll (suma de nómina mensual), seniority (antigüedad promedio).
Responde SOLO JSON, sin texto extra:
{ "metric": "headcount"|"payroll"|"seniority", "groupBy": "department"|"turno"|"planta"|"status"|"contrato", "title": string }
Elige la combinación que mejor responda la pregunta. Si es ambigua, usa metric=headcount, groupBy=department.`

const specSchema = z.object({
  metric:  z.string(),
  groupBy: z.string(),
  title:   z.string().optional().default(''),
})

const filtersSchema = z.object({
  department: z.string().optional(),
  shift:      z.string().optional(),
  dateRange:  z.object({ from: z.string().optional(), to: z.string().optional() }).optional(),
}).optional().default({})

const generateSchema = z.object({
  question: z.string().min(1),
  filters:  filtersSchema,
})

function stripJsonFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
}

async function checkDailyLimit(tenantId: string) {
  const key = `t:${tenantId}:reports:daily`
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, 86400)
  if (count > DAILY_LIMIT) throw new AppError(429, `Límite diario de ${DAILY_LIMIT} reportes de IA alcanzado.`)
}

async function interpret(question: string): Promise<{ metric: string; groupBy: string; title: string }> {
  try {
    const resp = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 300,
      system: INTERPRET_SYSTEM,
      messages: [{ role: 'user', content: question }],
    })
    const block = resp.content.find((b: any) => b.type === 'text') as { text: string } | undefined
    if (!block) throw new Error('sin texto')
    const spec = specSchema.parse(JSON.parse(stripJsonFences(block.text)))
    return {
      metric:  METRICS[spec.metric] ? spec.metric : 'headcount',
      groupBy: GROUP_COLS[spec.groupBy] ? spec.groupBy : 'department',
      title:   spec.title || question,
    }
  } catch {
    // Fallback determinista si la IA no está disponible o responde mal.
    return { metric: 'headcount', groupBy: 'department', title: question }
  }
}

async function narrate(question: string, metricLabel: string, dimLabel: string, rows: { name: string; value: number }[]): Promise<string> {
  const top = rows.slice(0, 8).map((r) => `${r.name}: ${r.value}`).join(', ')
  try {
    const resp = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 220,
      system: 'Eres analista de RH. Da una interpretación clara en español de 2-3 oraciones sobre los datos. Sin markdown, sin listas.',
      messages: [{ role: 'user', content: `Pregunta: ${question}\nMétrica: ${metricLabel} por ${dimLabel}.\nDatos: ${top}.` }],
    })
    const block = resp.content.find((b: any) => b.type === 'text') as { text: string } | undefined
    return block?.text.trim() || `Distribución de ${metricLabel.toLowerCase()} por ${dimLabel.toLowerCase()}.`
  } catch {
    return `Distribución de ${metricLabel.toLowerCase()} por ${dimLabel.toLowerCase()}.`
  }
}

// ── POST /api/reports/generate ───────────────────────────────
router.post('/generate', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { question, filters } = generateSchema.parse(req.body)
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb

    await checkDailyLimit(tenantId)

    const spec = await interpret(question)
    const dim = GROUP_COLS[spec.groupBy]
    const metric = METRICS[spec.metric]

    // WHERE parametrizado — solo el tenant y filtros opcionales. La columna
    // de agrupación y la expresión de métrica vienen de whitelists (seguras).
    const params: any[] = [tenantId]
    let where = `tenant_id = $1 AND ${dim.col} IS NOT NULL`
    if (filters.department) { params.push(filters.department); where += ` AND department = $${params.length}` }
    if (filters.shift)      { params.push(filters.shift);      where += ` AND shift = $${params.length}` }

    const sql = `SELECT ${dim.col} AS name, ${metric.expr} AS value
                 FROM employees WHERE ${where}
                 GROUP BY ${dim.col} ORDER BY value DESC`
    const raw = await tenantDb.$queryRawUnsafe(sql, ...params) as any[]

    const chartData = raw.map((r: any) => ({ name: String(r.name), value: Number(r.value) }))
    const total = chartData.reduce((a: number, r: { value: number }) => a + r.value, 0)
    const narrative = await narrate(question, metric.label, dim.label, chartData)

    const summary = [
      { label: metric.kind === 'money' ? 'Total nómina' : metric.kind === 'years' ? 'Promedio global' : 'Total', value: metric.kind === 'years' && chartData.length ? Number((total / chartData.length).toFixed(1)) : total, kind: metric.kind },
      { label: dim.plural, value: chartData.length, kind: 'count' },
      ...(chartData[0] ? [{ label: `Mayor: ${chartData[0].name}`, value: chartData[0].value, kind: metric.kind }] : []),
    ]

    const tableData = chartData.map((r) => ({ [dim.label]: r.name, [metric.label]: r.value }))

    res.json({
      question,
      spec: { metric: spec.metric, groupBy: spec.groupBy, title: spec.title },
      chartData, summary, narrative, tableData,
      metricLabel: metric.label, dimLabel: dim.label, metricKind: metric.kind,
    })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/reports/templates ───────────────────────────────
router.get('/templates', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await req.tenantDb.$queryRaw<any[]>`
      SELECT * FROM report_templates WHERE tenant_id = ${req.tenant.id} ORDER BY created_at DESC
    `
    res.json({ templates: rows })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/reports/templates ──────────────────────────────
const tplSchema = z.object({
  nombre:   z.string().min(1),
  pregunta: z.string().min(1),
  filtros:  z.record(z.string(), z.any()).optional().default({}),
})

router.post('/templates', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = tplSchema.parse(req.body)
    const rows = await req.tenantDb.$queryRaw<any[]>`
      INSERT INTO report_templates (tenant_id, nombre, pregunta, filtros, created_by)
      VALUES (${req.tenant.id}, ${input.nombre}, ${input.pregunta}, ${JSON.stringify(input.filtros)}::jsonb, ${req.jwt.email})
      RETURNING *
    `
    res.status(201).json({ template: rows[0] })
  } catch (err) {
    next(err)
  }
})

// ── DELETE /api/reports/templates/:id ────────────────────────
router.delete('/templates/:id', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await req.tenantDb.$queryRaw<any[]>`
      DELETE FROM report_templates WHERE id = ${req.params.id} AND tenant_id = ${req.tenant.id} RETURNING id
    `
    if (!rows[0]) throw new AppError(404, 'Reporte guardado no encontrado')
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router

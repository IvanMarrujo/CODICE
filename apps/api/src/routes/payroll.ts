// ============================================================
// CÓDICE · Payroll routes
// GET / — recibos de nómina de un empleado (schema del tenant).
// ============================================================

import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'
import { requireHR, requireEmployee } from '../middleware/auth'
import { AppError } from '../lib/errors'
import { redis } from '../lib/redis'
import { paginationQuerySchema, resolvePageSize, paginationMeta } from '../lib/pagination'

const router = Router()

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5'

const listQuerySchema = z.object({
  employeeId: z.string().min(1),
}).merge(paginationQuerySchema)

// ── GET /api/payroll/summary?period=2026-07-01 ───────────────
// Agregados de nómina para el período dado (o el más reciente si se omite).

const summaryQuerySchema = z.object({ period: z.string().optional() })

router.get('/summary', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { period } = summaryQuerySchema.parse(req.query)
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb

    const periodParam = period ?? null
    const rows = await tenantDb.$queryRaw<any[]>`
      WITH target_period AS (
        SELECT COALESCE(
          ${periodParam}::date,
          (SELECT MAX(pr.period_start) FROM payroll_records pr WHERE pr.tenant_id = ${tenantId})
        ) AS ps
      )
      SELECT
        (SELECT ps FROM target_period)              AS period,
        COALESCE(SUM(total_income), 0)::float      AS "totalPercepciones",
        COALESCE(SUM(total_deductions), 0)::float   AS "totalDeducciones",
        COALESCE(SUM(net_pay), 0)::float            AS "totalNeto",
        COALESCE(SUM(isr), 0)::float                AS "totalISR",
        COALESCE(SUM(imss_employee), 0)::float      AS "totalIMSS",
        COALESCE(SUM(infonavit), 0)::float          AS "totalINFONAVIT",
        COALESCE(SUM(other_deductions), 0)::float   AS "totalOtras",
        COUNT(DISTINCT employee_id)::int            AS "employeeCount"
      FROM payroll_records, target_period
      WHERE tenant_id = ${tenantId} AND period_start = target_period.ps
    `
    res.json(rows[0] ?? null)
  } catch (err) {
    next(err)
  }
})

// ── GET /api/payroll/latest-by-employee ──────────────────────
// Último recibo (por fecha de pago) de cada empleado del tenant.
// Usado por Plantilla ("Último neto") e Indicadores WKF.

router.get('/latest-by-employee', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb

    const data = await tenantDb.$queryRaw<any[]>`
      SELECT DISTINCT ON (employee_id)
        employee_id AS "employeeId", net_pay AS "netPay", total_income AS "totalIncome",
        total_deductions AS "totalDeductions", payment_date AS "paymentDate"
      FROM payroll_records
      WHERE tenant_id = ${tenantId}
      ORDER BY employee_id, payment_date DESC NULLS LAST
    `
    res.json({ data })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/payroll/:id/explain ──────────────────────────────
// Explicación de deducciones generada por IA (español simple), cacheada en
// Redis 7 días (el recibo ya emitido no cambia). Una sola generación por
// recibo produce ambas variantes (admin / colaborador) para no duplicar
// llamadas al modelo entre el panel RH y Mis Pagos.

const EXPLAIN_TTL_SECONDS = 7 * 24 * 60 * 60

const PAYROLL_AI_SYSTEM = `Eres el motor de IA de nómina de CÓDICE, para empresas mexicanas de manufactura y \
empaque de alimentos.
Analiza este recibo de nómina y explica cada deducción en español simple, como si le explicaras al empleado \
por qué le descontaron ese monto. Cita el artículo de ley o la tasa oficial cuando corresponda (LFT, IMSS, SAT).
Sé conciso — máximo 4 oraciones. No uses bullet points.

Genera DOS versiones de la misma explicación y responde ÚNICAMENTE con un objeto JSON válido, sin texto \
adicional ni bloques de código:
{"admin": "versión técnica en tercera persona, citando tasas y artículos, para un analista de RH",
 "employee": "versión en segunda persona ('tu descuento de...'), simple y empática, para el colaborador"}`

function buildPayrollPrompt(record: any): string {
  const lines = [
    `Período: ${record.period_start} a ${record.period_end} (pago ${record.payment_date})`,
    `Percepción gravada: $${record.gross_taxable}`,
    `Percepción exenta: $${record.gross_exempt}`,
    `Total percepciones: $${record.total_income}`,
  ]
  if (Number(record.isr) > 0)              lines.push(`ISR retenido: $${record.isr}`)
  if (Number(record.imss_employee) > 0)    lines.push(`IMSS (cuota obrera): $${record.imss_employee}`)
  if (Number(record.infonavit) > 0)        lines.push(`INFONAVIT: $${record.infonavit}`)
  if (Number(record.other_deductions) > 0) lines.push(`Otras deducciones (préstamos/adelantos): $${record.other_deductions}`)
  lines.push(`Total deducciones: $${record.total_deductions}`)
  lines.push(`Neto pagado: $${record.net_pay}`)
  return lines.join('\n')
}

async function generateExplanation(record: any): Promise<{ admin: string; employee: string }> {
  const message = await anthropic.messages.create({
    model:      MODEL,
    max_tokens: 700,
    system:     PAYROLL_AI_SYSTEM,
    messages:   [{ role: 'user', content: buildPayrollPrompt(record) }],
  })
  const text = message.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim()
  const jsonText = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const parsed = JSON.parse(jsonText)
  if (!parsed.admin || !parsed.employee) throw new Error('Respuesta de IA incompleta')
  return { admin: parsed.admin, employee: parsed.employee }
}

router.get('/:id/explain', requireEmployee, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb
    const recordId = req.params.id

    const rows = await tenantDb.$queryRaw<any[]>`
      SELECT * FROM payroll_records WHERE id = ${recordId} AND tenant_id = ${tenantId} LIMIT 1
    `
    const record = rows[0]
    if (!record) throw new AppError(404, 'Recibo de nómina no encontrado')

    // Un colaborador solo puede pedir la explicación de su propio recibo.
    if (req.jwt.role === 'EMPLOYEE' && record.employee_id !== req.jwt.sub) {
      throw new AppError(403, 'No tienes permiso para ver este recibo')
    }

    const totalDeductions = Number(record.total_deductions) || 0
    if (totalDeductions <= 0) {
      return res.json({ applicable: false })
    }

    const cacheKey = `t:${tenantId}:ai:payroll:${recordId}`
    const cached = await redis.get(cacheKey)
    let explanation: { admin: string; employee: string }

    if (cached) {
      explanation = JSON.parse(cached)
    } else {
      explanation = await generateExplanation(record)
      await redis.set(cacheKey, JSON.stringify(explanation), 'EX', EXPLAIN_TTL_SECONDS)
    }

    // El panel RH no tiene login de colaborador real todavía (ver auth.ts):
    // Mis Pagos usa un token puente HR_MANAGER, así que el rol del JWT no
    // basta para distinguir la audiencia. El shell colaborador manda
    // ?audience=employee explícitamente (mismo patrón que ya usa employeeId
    // como parámetro confiable en attendance/requests de este demo).
    const tone = (req.jwt.role === 'EMPLOYEE' || req.query.audience === 'employee') ? 'employee' : 'admin'
    res.json({
      applicable: true,
      tone,
      text:    explanation[tone],
      sources: 'LFT 2026 · IMSS · SAT',
    })
  } catch (err) {
    next(err)
  }
})

router.get('/', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = listQuerySchema.parse(req.query)
    const { employeeId, page } = parsed
    const pageSize = resolvePageSize(parsed)
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb
    const offset = (page - 1) * pageSize

    const [data, totalRows] = await Promise.all([
      tenantDb.$queryRaw<any[]>`
        SELECT * FROM payroll_records
        WHERE tenant_id = ${tenantId} AND employee_id = ${employeeId}
        ORDER BY payment_date DESC NULLS LAST, created_at DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `,
      tenantDb.$queryRaw<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM payroll_records
        WHERE tenant_id = ${tenantId} AND employee_id = ${employeeId}
      `,
    ])

    res.json({ data, ...paginationMeta(page, pageSize, totalRows[0]?.count ?? 0) })
  } catch (err) {
    next(err)
  }
})

// ── DELETE /api/payroll/bulk?employeeId=X ────────────────────
// "Limpiar historial de nómina": borra TODOS los recibos de un empleado.
// Se registra ANTES de '/:id' — si no, Express matchea "/bulk" contra el
// parámetro :id (cualquier string).

const bulkDeleteQuerySchema = z.object({ employeeId: z.string().min(1) })

router.delete('/bulk', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { employeeId } = bulkDeleteQuerySchema.parse(req.query)
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb

    const deleted = await tenantDb.$queryRaw<{ id: string }[]>`
      DELETE FROM payroll_records WHERE tenant_id = ${tenantId} AND employee_id = ${employeeId} RETURNING id
    `
    // Los recibos ya no existen — su explicación de IA cacheada tampoco debe sobrevivir.
    await Promise.all(deleted.map((row: { id: string }) => redis.del(`t:${tenantId}:ai:payroll:${row.id}`)))

    req.app.get('io')?.to(`tenant:${tenantId}`).emit('payroll:bulk_deleted', { employeeId, deleted: deleted.length })

    res.json({ deleted: deleted.length })
  } catch (err) {
    next(err)
  }
})

// ── DELETE /api/payroll/:id ───────────────────────────────────
// Elimina un recibo individual — sin deshacer.

router.delete('/:id', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb
    const recordId = req.params.id

    const rows = await tenantDb.$queryRaw<any[]>`
      DELETE FROM payroll_records WHERE id = ${recordId} AND tenant_id = ${tenantId} RETURNING *
    `
    const record = rows[0]
    if (!record) throw new AppError(404, 'Recibo de nómina no encontrado')

    await redis.del(`t:${tenantId}:ai:payroll:${recordId}`)

    req.app.get('io')?.to(`tenant:${tenantId}`).emit('payroll:deleted', { recordId, employeeId: record.employee_id })

    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router

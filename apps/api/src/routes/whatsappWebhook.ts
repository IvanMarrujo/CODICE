// ============================================================
// CÓDICE · Agente consultivo de WhatsApp
// POST /whatsapp — webhook público (Green API u otro proveedor de
// WhatsApp posa aquí los mensajes entrantes). Mount BEFORE auth
// middleware — un proveedor externo no puede mandar un JWT nuestro.
// POST /whatsapp/simulate — mismo pipeline, pero autenticado
// (requireHR), para probar el agente desde la UI sin WhatsApp real.
// ============================================================

import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'
import { authMiddleware } from '../middleware/auth'
import { tenantMiddleware, getTenantPrisma } from '../middleware/tenant'
import { requireHR } from '../middleware/auth'
import { prismaPublic } from '../lib/prisma'
import { sendWhatsApp } from '../lib/whatsapp'

const router = Router()

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const AI_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5'

// ── Intent detection ─────────────────────────────────────────────

const INTENT_KEYWORDS: Record<string, string[]> = {
  headcount:    ['cuantos', 'empleados', 'activos', 'plantilla', 'total'],
  vacaciones:   ['vacaciones', 'descansando'],
  incapacidad:  ['incapacidad', 'incapacitado', 'enfermo'],
  asistencia:   ['falto', 'faltas', 'inasistencia', 'checo', 'retardo'],
  nomina:       ['nomina', 'salario', 'costo', 'masa salarial', 'neto', 'isr'],
  solicitudes:  ['solicitudes', 'pendientes', 'aprobar'],
  contratos:    ['contrato', 'vence', 'periodo de prueba'],
  salud:        ['salud', 'alerta', 'riesgo'],
  capacitacion: ['curso', 'capacitacion', 'constancia'],
  general:      [],
}
const INTENT_ORDER = ['headcount', 'vacaciones', 'incapacidad', 'asistencia', 'nomina', 'solicitudes', 'contratos', 'salud', 'capacitacion']

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function detectIntent(message: string): string {
  const norm = normalize(message)
  for (const intent of INTENT_ORDER) {
    if (INTENT_KEYWORDS[intent].some((kw) => norm.includes(normalize(kw)))) return intent
  }
  return 'general'
}

// ── Queries por intent — todas escopadas al schema del tenant vía
// req.tenantDb (search_path ya seteado por tenantMiddleware/getTenantPrisma) ─

async function queryForIntent(intent: string, tenantDb: any, tenantId: string): Promise<any> {
  switch (intent) {
    case 'headcount':
      return tenantDb.$queryRaw`
        SELECT status, COUNT(*)::int AS count FROM employees
        WHERE tenant_id = ${tenantId} GROUP BY status
      `
    case 'vacaciones':
      return tenantDb.$queryRaw`
        SELECT full_name, department FROM employees
        WHERE tenant_id = ${tenantId} AND status = 'Vacaciones' LIMIT 20
      `
    case 'incapacidad':
      return tenantDb.$queryRaw`
        SELECT full_name, department FROM employees
        WHERE tenant_id = ${tenantId} AND status = 'Incapacidad' LIMIT 20
      `
    case 'asistencia':
      // "Quién faltó hoy" — activos sin check-in el día de hoy.
      return tenantDb.$queryRaw`
        SELECT e.full_name, e.department
        FROM employees e
        LEFT JOIN attendance_records a
          ON a.employee_id = e.id AND a.tenant_id = e.tenant_id AND a.check_in_at::date = CURRENT_DATE
        WHERE e.tenant_id = ${tenantId} AND e.status = 'Activo' AND a.id IS NULL
        LIMIT 20
      `
    case 'nomina':
      return tenantDb.$queryRaw`
        SELECT SUM(net_pay) AS total_neto, SUM(isr) AS total_isr, SUM(imss_employee) AS total_imss, COUNT(*)::int AS recibos
        FROM payroll_records
        WHERE tenant_id = ${tenantId}
          AND period_label = (SELECT MAX(period_label) FROM payroll_records WHERE tenant_id = ${tenantId})
      `
    case 'solicitudes':
      return tenantDb.$queryRaw`
        SELECT type, stage, COUNT(*)::int AS count FROM requests
        WHERE tenant_id = ${tenantId} AND stage IN ('MANAGER', 'WORKFORCE')
        GROUP BY type, stage
      `
    case 'contratos':
      return tenantDb.$queryRaw`
        SELECT e.full_name, c.end_date FROM contracts c
        JOIN employees e ON e.id = c.employee_id
        WHERE c.tenant_id = ${tenantId} AND c.end_date BETWEEN NOW() AND NOW() + INTERVAL '30 days'
        LIMIT 20
      `
    case 'salud':
      return tenantDb.$queryRaw`
        SELECT COUNT(*)::int AS count FROM health_profiles
        WHERE tenant_id = ${tenantId} AND documentos::text LIKE '%urgente%'
      `
    case 'capacitacion':
      return tenantDb.$queryRaw`
        SELECT c.title, COUNT(*)::int AS pending FROM course_progress cp
        JOIN courses c ON c.id = cp.course_id
        WHERE cp.tenant_id = ${tenantId} AND c.tenant_id = ${tenantId} AND cp.passed = false AND c.is_mandatory = true
        GROUP BY c.title
      `
    default:
      return null
  }
}

const AGENT_SYSTEM_PROMPT_BASE = `Responde en máximo 3 líneas. Español directo. Sin markdown. Sin asteriscos.
Solo datos concretos. Tono profesional pero cercano.`

function jsonSafe(rows: any): string {
  return JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? Number(v) : v))
}

async function runAgent(message: string, tenantId: string, tenantName: string): Promise<{ response: string; intent: string; data: any }> {
  const tenant = await prismaPublic.tenant.findUnique({ where: { id: tenantId }, select: { dbSchema: true } })
  if (!tenant) throw new Error('Tenant no encontrado')
  const tenantDb = await getTenantPrisma(tenant.dbSchema)
  await tenantDb.$executeRawUnsafe(`SET search_path = "${tenant.dbSchema}", public`)

  const intent = detectIntent(message)
  const data = await queryForIntent(intent, tenantDb, tenantId)

  const system = `Eres el asistente de RH de ${tenantName}.\n${AGENT_SYSTEM_PROMPT_BASE}`
  const userMessage = data
    ? `Pregunta: ${message}\n\nDatos de la consulta (${intent}): ${jsonSafe(data)}`
    : `Pregunta: ${message}\n\n(Sin datos específicos del sistema para esta pregunta — responde de forma general y breve, o indica que no tienes esa información.)`

  const completion = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 300,
    system,
    messages: [{ role: 'user', content: userMessage }],
  })
  const textBlock = completion.content.find((b: any) => b.type === 'text') as { type: 'text'; text: string } | undefined
  const response = textBlock?.text?.trim() || 'No pude generar una respuesta en este momento.'

  return { response, intent, data }
}

// ── Extracción del mensaje entrante (formato Green API) ──────────

function extractIncoming(body: any): { phone: string | null; message: string | null } {
  const senderData  = body?.senderData || {}
  const messageData = body?.messageData || {}
  const rawChatId: string | undefined = senderData.sender || senderData.chatId || body?.phone
  const phone = rawChatId ? rawChatId.replace('@c.us', '').replace(/\D/g, '') : (body?.phone || null)
  const message =
    messageData?.textMessageData?.textMessage ??
    messageData?.extendedTextMessageData?.text ??
    body?.message ??
    null
  return { phone, message }
}

function last10(phone: string): string {
  return phone.replace(/\D/g, '').slice(-10)
}

async function findAdminByPhone(phone: string) {
  const candidates = await prismaPublic.adminUser.findMany({
    where:  { phone: { not: null }, isActive: true },
    select: { id: true, tenantId: true, phone: true },
  })
  const target = last10(phone)
  return candidates.find((c) => c.phone && last10(c.phone) === target) || null
}

// ── POST /whatsapp — webhook público, sin auth ────────────────────

router.post('/whatsapp', async (req: Request, res: Response) => {
  try {
    const { phone, message } = extractIncoming(req.body)
    if (!phone || !message) return res.status(200).json({ ok: true })

    const admin = await findAdminByPhone(phone)
    if (!admin) return res.status(200).json({ ok: true })

    const tenant = await prismaPublic.tenant.findUnique({ where: { id: admin.tenantId }, select: { name: true } })
    if (!tenant) return res.status(200).json({ ok: true })

    const { response } = await runAgent(message, admin.tenantId, tenant.name)
    await sendWhatsApp(phone, response, admin.tenantId)

    res.status(200).json({ ok: true })
  } catch (err: any) {
    console.error('❌  whatsapp webhook falló:', err.message)
    res.status(200).json({ ok: true }) // nunca devolver error al proveedor — evita reintentos en cascada
  }
})

// ── POST /whatsapp/simulate — autenticado, para el widget de prueba ─

const simulateSchema = z.object({ message: z.string().min(1) })

router.post(
  '/whatsapp/simulate',
  authMiddleware, tenantMiddleware, requireHR,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { message } = simulateSchema.parse(req.body)
      const result = await runAgent(message, req.tenant.id, req.tenant.name)
      res.json(result)
    } catch (err) {
      next(err)
    }
  }
)

export default router

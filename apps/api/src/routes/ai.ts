// ============================================================
// CÓDICE · AI proxy
// POST /api/ai/consult — proxy a Anthropic con streaming SSE.
// Ya está detrás del pipeline autenticado (rateLimit -> JWT -> tenant),
// ver index.ts. Aquí solo se agrega el límite diario por tenant.
// ============================================================

import { Router, Request, Response, NextFunction } from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { requireHR } from '../middleware/auth'
import { redis } from '../lib/redis'
import { AppError } from '../lib/errors'

const router = Router()

router.get('/', (req, res) => res.json({ route: 'ai', status: 'ok' }))

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5'

const DAILY_LIMIT = 50

const SYSTEM_PROMPT = `Eres un asistente experto en la Ley Federal del Trabajo (LFT) de México, \
incluyendo la reforma de jornada laboral 2026-2030 (reducción escalonada de 48 a 40 horas semanales) \
y la reforma de vacaciones dignas de 2023. Atiendes específicamente a empresas del sector manufactura \
y empacado de alimentos, y estás familiarizado con la integración de datos de nómina desde sistemas \
legacy como Contpaq y Nomipaq.

Reglas:
- Siempre que sea posible, cita el artículo específico de la LFT en el que basas tu respuesta.
- Sé preciso y práctico, orientado a un equipo de Recursos Humanos, no a abogados.
- Al final de cada respuesta, recuerda brevemente que tu respuesta es orientativa y no constituye \
asesoría legal formal; para casos específicos se debe consultar a un abogado laboral.`

const consultSchema = z.object({
  question: z.string().min(1),
  context:  z.string().optional(),
})

// Segundos restantes hasta la medianoche local — TTL de la ventana diaria.
function secondsUntilEndOfDay(): number {
  const now = new Date()
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0)
  return Math.max(1, Math.ceil((endOfDay.getTime() - now.getTime()) / 1000))
}

async function checkDailyLimit(tenantId: string) {
  const key = `t:${tenantId}:ai:daily`
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, secondsUntilEndOfDay())
  if (count > DAILY_LIMIT) {
    throw new AppError(429, `Límite diario de ${DAILY_LIMIT} consultas de IA alcanzado para este tenant.`)
  }
}

router.post('/consult', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { question, context } = consultSchema.parse(req.body)
    const tenantId = req.tenant.id

    await checkDailyLimit(tenantId)

    const userMessage = context ? `Contexto: ${context}\n\nPregunta: ${question}` : question

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const stream = anthropic.messages.stream({
      model:      MODEL,
      max_tokens: 1024,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: userMessage }],
    })

    let finished = false
    const finish = (payload: object) => {
      if (finished || res.writableEnded) return
      finished = true
      res.write(`data: ${JSON.stringify(payload)}\n\n`)
      res.end()
    }

    stream.on('text', (delta) => {
      if (finished || res.writableEnded) return
      res.write(`data: ${JSON.stringify({ type: 'delta', text: delta })}\n\n`)
    })

    stream.on('error', (err: any) => finish({ type: 'error', message: err.message }))
    stream.on('end',   () => finish({ type: 'done' }))

    req.on('close', () => stream.abort())
  } catch (err) {
    next(err)
  }
})

export default router

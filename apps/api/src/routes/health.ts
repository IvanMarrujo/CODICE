// ============================================================
// CÓDICE · Perfil de salud del colaborador
// Tabla `health_profiles` del schema del tenant — datos médicos
// confidenciales (LFPDPPP Art. 8), solo requireHR.
// req.tenantDb ya tiene el search_path apuntando al tenant.
// ============================================================

import { Router, Request, Response, NextFunction, RequestHandler } from 'express'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import multer from 'multer'
import * as path from 'path'
import * as crypto from 'crypto'
import Anthropic from '@anthropic-ai/sdk'
import { requireHR } from '../middleware/auth'
import { AppError } from '../lib/errors'
import { saveFile, readFile, deleteFile } from '../lib/storage'
import { findEmployeeOr404, insertAuditLog } from './employees'
import { redis } from '../lib/redis'
import { getIO } from '../lib/syncEmitter'

const router = Router()

const HEALTH_BUCKET = 'health'

// ── Extractor de insights por IA (Claude) ───────────────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const AI_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5'

const INSIGHTS_SYSTEM_PROMPT = `Eres un asistente médico de RH. Analiza este documento médico y extrae los insights más importantes en español.
Responde SOLO con JSON:
{
  tipo: string (ej: 'Análisis de sangre', 'Radiografía', 'Examen médico'),
  fecha_documento: string or null,
  insights: [
    { categoria: string, hallazgo: string, nivel: 'normal'|'atención'|'urgente' }
  ],
  resumen: string (2-3 oraciones máximo)
}`

const aiInsightsSchema = z.object({
  tipo: z.string(),
  fecha_documento: z.string().nullable(),
  insights: z.array(z.object({
    categoria: z.string(),
    hallazgo: z.string(),
    nivel: z.enum(['normal', 'atención', 'urgente']),
  })),
  resumen: z.string(),
})

// Tope diario por tenant — el análisis se dispara automáticamente en cada
// upload (no hay confirmación explícita del usuario por llamada, a
// diferencia de /api/ai/consult), así que necesita su propio límite de
// costo independiente del de ese endpoint.
const HEALTH_AI_DAILY_LIMIT = 30

function healthAiDailyKey(tenantId: string) {
  return `t:${tenantId}:ai:health-docs:daily`
}
function secondsUntilEndOfDay(): number {
  const now = new Date()
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0)
  return Math.max(1, Math.ceil((endOfDay.getTime() - now.getTime()) / 1000))
}
async function underHealthAiDailyLimit(tenantId: string): Promise<boolean> {
  const key = healthAiDailyKey(tenantId)
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, secondsUntilEndOfDay())
  return count <= HEALTH_AI_DAILY_LIMIT
}

function stripJsonFences(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return fenced ? fenced[1] : trimmed
}

// Actualiza (merge, no reemplaza) la entrada de `documentos` cuyo `id`
// coincide — usado tanto al guardar insights como al marcar error/estado.
async function patchDocumentEntry(tenantDb: any, tenantId: string, employeeId: string, docId: string, patch: Record<string, unknown>) {
  await tenantDb.$executeRaw`
    UPDATE health_profiles
    SET documentos = (
      SELECT COALESCE(jsonb_agg(
        CASE WHEN d->>'id' = ${docId} THEN d || ${JSON.stringify(patch)}::jsonb ELSE d END
      ), '[]'::jsonb)
      FROM jsonb_array_elements(documentos) AS d
    )
    WHERE tenant_id = ${tenantId} AND employee_id = ${employeeId}
  `
}

async function analyzeHealthDocument(opts: {
  tenantDb: any; tenantId: string; employeeId: string; docId: string
  buffer: Buffer; contentType: string; filename: string
}) {
  const { tenantDb, tenantId, employeeId, docId, buffer, contentType, filename } = opts
  try {
    const withinLimit = await underHealthAiDailyLimit(tenantId)
    if (!withinLimit) {
      await patchDocumentEntry(tenantDb, tenantId, employeeId, docId, { status: 'error', analysisError: 'Límite diario de análisis de IA alcanzado' })
      return
    }

    const base64 = buffer.toString('base64')
    const isPdf = contentType === 'application/pdf'
    // PDF nativo (leído directamente por el modelo, sin OCR/extracción propia)
    // solo está tipado bajo el cliente `beta` en esta versión del SDK.
    const contentBlock = isPdf
      ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: base64 } }
      : { type: 'image' as const, source: { type: 'base64' as const, media_type: contentType as 'image/jpeg' | 'image/png', data: base64 } }

    const response = await anthropic.beta.messages.create({
      model: AI_MODEL,
      max_tokens: 1024,
      system: INSIGHTS_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: `Analiza este documento médico: ${filename}` }] }],
    })

    const textBlock = response.content.find((b: any) => b.type === 'text') as { type: 'text'; text: string } | undefined
    if (!textBlock) throw new Error('Respuesta de IA sin contenido de texto')

    const parsed = aiInsightsSchema.parse(JSON.parse(stripJsonFences(textBlock.text)))

    await patchDocumentEntry(tenantDb, tenantId, employeeId, docId, {
      status: 'ready',
      tipo: parsed.tipo,
      fecha_documento: parsed.fecha_documento,
      insights: parsed.insights,
      resumen: parsed.resumen,
    })

    const urgentes = parsed.insights.filter((i) => i.nivel === 'urgente')
    if (urgentes.length > 0) {
      await tenantDb.$executeRaw`
        INSERT INTO notifications (tenant_id, employee_id, type, title, body, link)
        VALUES (${tenantId}, ${employeeId}, 'HEALTH_ALERT', 'Alerta de salud detectada',
                'Se detectaron hallazgos urgentes en documento médico reciente', ${'/empleados/' + employeeId + '?tab=salud'})
      `
      getIO()?.to(`tenant:${tenantId}`).emit('health:alert', {
        employeeId, docId, filename, urgentes: urgentes.length, tipo: parsed.tipo,
      })
    }
  } catch (err: any) {
    console.error(`❌  Análisis de IA falló para documento ${docId}:`, err.message)
    await patchDocumentEntry(tenantDb, tenantId, employeeId, docId, { status: 'error', analysisError: 'No se pudo analizar el documento' }).catch(() => {})
  }
}

function emptyHealthProfile(tenantId: string, employeeId: string) {
  return {
    id: null,
    tenant_id: tenantId,
    employee_id: employeeId,
    tipo_sangre: null,
    alergias: [],
    condiciones_declaradas: [],
    medicamentos: [],
    contacto_emergencia_nombre: null,
    contacto_emergencia_telefono: null,
    contacto_emergencia_relacion: null,
    fecha_ultimo_examen: null,
    notas_medicas: null,
    documentos: [],
    created_at: null,
    updated_at: null,
  }
}

async function findHealthProfile(tenantDb: any, tenantId: string, employeeId: string) {
  const rows = await tenantDb.$queryRaw<any[]>`
    SELECT * FROM health_profiles WHERE tenant_id = ${tenantId} AND employee_id = ${employeeId} LIMIT 1
  `
  return rows[0] || null
}

// ── GET /api/employees/:id/health ─────────────────────────────

router.get('/:id/health', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb
    await findEmployeeOr404(tenantDb, tenantId, req.params.id)

    const profile = await findHealthProfile(tenantDb, tenantId, req.params.id)
    res.json(profile || emptyHealthProfile(tenantId, req.params.id))
  } catch (err) {
    next(err)
  }
})

// ── PATCH /api/employees/:id/health ───────────────────────────

const healthPatchSchema = z.object({
  tipoSangre:                  z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).nullable().optional(),
  alergias:                    z.array(z.string()).optional(),
  condicionesDeclaradas:       z.array(z.string()).optional(),
  medicamentos:                z.array(z.string()).optional(),
  contactoEmergenciaNombre:    z.string().nullable().optional(),
  contactoEmergenciaTelefono:  z.string().nullable().optional(),
  contactoEmergenciaRelacion:  z.string().nullable().optional(),
  fechaUltimoExamen:           z.string().nullable().optional(), // ISO date
  notasMedicas:                z.string().nullable().optional(),
})

const HEALTH_COLUMN_MAP: Record<string, string> = {
  tipoSangre:                 'tipo_sangre',
  contactoEmergenciaNombre:   'contacto_emergencia_nombre',
  contactoEmergenciaTelefono: 'contacto_emergencia_telefono',
  contactoEmergenciaRelacion: 'contacto_emergencia_relacion',
  fechaUltimoExamen:          'fecha_ultimo_examen',
  notasMedicas:                'notas_medicas',
}
const HEALTH_JSONB_COLUMN_MAP: Record<string, string> = {
  alergias:               'alergias',
  condicionesDeclaradas:  'condiciones_declaradas',
  medicamentos:           'medicamentos',
}

router.patch('/:id/health', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = healthPatchSchema.parse(req.body)
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb
    const employeeId = req.params.id

    await findEmployeeOr404(tenantDb, tenantId, employeeId)

    const entries = Object.entries(input).filter(([, v]) => v !== undefined) as [string, unknown][]
    if (entries.length === 0) throw new AppError(400, 'No se enviaron campos para actualizar')

    // Asegura que exista la fila antes del UPDATE dinámico (upsert en 2 pasos).
    await tenantDb.$executeRaw`
      INSERT INTO health_profiles (tenant_id, employee_id) VALUES (${tenantId}, ${employeeId})
      ON CONFLICT (tenant_id, employee_id) DO NOTHING
    `

    const setFragments = entries.map(([k, v]) => {
      if (HEALTH_JSONB_COLUMN_MAP[k]) {
        return Prisma.sql`${Prisma.raw(HEALTH_JSONB_COLUMN_MAP[k])} = ${JSON.stringify(v)}::jsonb`
      }
      return Prisma.sql`${Prisma.raw(HEALTH_COLUMN_MAP[k])} = ${v}`
    })

    const rows = await tenantDb.$queryRaw<any[]>`
      UPDATE health_profiles SET ${Prisma.join(setFragments, ', ')}
      WHERE tenant_id = ${tenantId} AND employee_id = ${employeeId}
      RETURNING *
    `
    const profile = rows[0]

    await insertAuditLog(tenantDb, tenantId, req, 'employee.health_updated', `employee:${employeeId}`, { fields: Object.keys(input) })

    res.json(profile)
  } catch (err) {
    next(err)
  }
})

// ── Upload middleware ──────────────────────────────────────────

const ALLOWED_DOC_EXT = new Set(['.pdf', '.jpg', '.jpeg', '.png'])
const ALLOWED_DOC_MIME: Record<string, string> = {
  '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
}

const docUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (!ALLOWED_DOC_EXT.has(ext)) {
      return cb(new AppError(400, `Tipo de archivo no soportado: "${file.originalname}". Solo se aceptan PDF, JPG y PNG`))
    }
    cb(null, true)
  },
}).single('file')

function handleDocUpload(req: Request, res: Response, next: NextFunction) {
  (docUpload as RequestHandler)(req, res, (err: any) => {
    if (!err) return next()
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'El archivo supera el máximo permitido (10MB)' : err.message
      return next(new AppError(400, msg))
    }
    next(err)
  })
}

// ── POST /api/employees/:id/health/documents ──────────────────

router.post('/:id/health/documents', requireHR, handleDocUpload, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb
    const employeeId = req.params.id
    const file = req.file as Express.Multer.File | undefined
    if (!file) throw new AppError(400, 'No se subió ningún archivo')

    await findEmployeeOr404(tenantDb, tenantId, employeeId)

    const ext = path.extname(file.originalname).toLowerCase()
    const docId = crypto.randomUUID()
    const key = `${tenantId}/${employeeId}/${docId}${ext}`
    const contentType = ALLOWED_DOC_MIME[ext] || file.mimetype

    await saveFile(key, file.buffer, contentType, HEALTH_BUCKET)

    const doc = {
      id: docId,
      filename: file.originalname,
      key,
      size: file.size,
      mimeType: contentType,
      uploadedAt: new Date().toISOString(),
      uploadedBy: req.jwt.email,
      status: 'processing',
    }

    await tenantDb.$executeRaw`
      INSERT INTO health_profiles (tenant_id, employee_id) VALUES (${tenantId}, ${employeeId})
      ON CONFLICT (tenant_id, employee_id) DO NOTHING
    `
    await tenantDb.$executeRaw`
      UPDATE health_profiles
      SET documentos = documentos || jsonb_build_array(${JSON.stringify(doc)}::jsonb)
      WHERE tenant_id = ${tenantId} AND employee_id = ${employeeId}
    `

    await insertAuditLog(tenantDb, tenantId, req, 'employee.health_document_uploaded', `employee:${employeeId}`, { filename: doc.filename, docId })

    res.status(201).json({ id: docId, url: `/api/employees/${employeeId}/health/documents/${docId}/download`, filename: doc.filename, size: doc.size, uploadedAt: doc.uploadedAt, status: doc.status })

    // Análisis de IA — corre después de responder (no bloquea el upload);
    // el front hace polling de /health/documents/:docId/insights mientras
    // status === 'processing'.
    analyzeHealthDocument({ tenantDb, tenantId, employeeId, docId, buffer: file.buffer, contentType, filename: file.originalname })
      .catch((err) => console.error('❌  analyzeHealthDocument sin capturar:', err.message))
  } catch (err) {
    next(err)
  }
})

// ── GET /api/employees/:id/health/documents/:docId/download ───

router.get('/:id/health/documents/:docId/download', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb
    const { id: employeeId, docId } = req.params

    const profile = await findHealthProfile(tenantDb, tenantId, employeeId)
    const doc = (profile?.documentos || []).find((d: any) => d.id === docId)
    if (!doc) throw new AppError(404, 'Documento no encontrado')

    const { buffer, contentType } = await readFile(doc.key, HEALTH_BUCKET)
    res.setHeader('Content-Type', contentType || doc.mimeType || 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.filename)}"`)
    res.send(buffer)
  } catch (err) {
    next(err)
  }
})

// ── GET /api/employees/:id/health/documents/:docId/insights ───
// Usado por el front para hacer polling mientras status === 'processing'.

router.get('/:id/health/documents/:docId/insights', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb
    const { id: employeeId, docId } = req.params

    const profile = await findHealthProfile(tenantDb, tenantId, employeeId)
    const doc = (profile?.documentos || []).find((d: any) => d.id === docId)
    if (!doc) throw new AppError(404, 'Documento no encontrado')

    res.json({
      id: doc.id,
      status: doc.status || 'ready', // documentos subidos antes de este feature no tienen status
      tipo: doc.tipo ?? null,
      fecha_documento: doc.fecha_documento ?? null,
      insights: doc.insights ?? null,
      resumen: doc.resumen ?? null,
      analysisError: doc.analysisError ?? null,
    })
  } catch (err) {
    next(err)
  }
})

// ── DELETE /api/employees/:id/health/documents/:docId ──────────

router.delete('/:id/health/documents/:docId', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb
    const { id: employeeId, docId } = req.params

    const profile = await findHealthProfile(tenantDb, tenantId, employeeId)
    const doc = (profile?.documentos || []).find((d: any) => d.id === docId)
    if (!doc) throw new AppError(404, 'Documento no encontrado')

    const rows = await tenantDb.$queryRaw<any[]>`
      UPDATE health_profiles
      SET documentos = (
        SELECT COALESCE(jsonb_agg(d), '[]'::jsonb)
        FROM jsonb_array_elements(documentos) AS d
        WHERE d->>'id' != ${docId}
      )
      WHERE tenant_id = ${tenantId} AND employee_id = ${employeeId}
      RETURNING *
    `

    await deleteFile(doc.key, HEALTH_BUCKET).catch(() => {})
    await insertAuditLog(tenantDb, tenantId, req, 'employee.health_document_deleted', `employee:${employeeId}`, { filename: doc.filename, docId })

    res.json(rows[0])
  } catch (err) {
    next(err)
  }
})

export default router

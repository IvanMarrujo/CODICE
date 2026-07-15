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
import { requireHR } from '../middleware/auth'
import { AppError } from '../lib/errors'
import { saveFile, readFile, deleteFile } from '../lib/storage'
import { findEmployeeOr404, insertAuditLog } from './employees'

const router = Router()

const HEALTH_BUCKET = 'health'

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

    res.status(201).json({ id: docId, url: `/api/employees/${employeeId}/health/documents/${docId}/download`, filename: doc.filename, size: doc.size, uploadedAt: doc.uploadedAt })
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

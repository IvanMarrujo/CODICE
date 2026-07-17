// ============================================================
// CÓDICE Radar · Perfiles de riesgo ocupacional por departamento
// GET   /api/risk/departments            (requireHR) — lista completa
// GET   /api/risk/departments/:dept      (requireHR) — un depto
// PATCH /api/risk/departments/:dept      (requireHR) — edita perfil
// POST  /api/risk/departments/:dept/accidente (requireHR) — registra accidente
//
// req.tenantDb ya tiene el search_path apuntando al tenant.
// ============================================================

import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import * as crypto from 'crypto'
import { requireHR } from '../middleware/auth'
import { AppError } from '../lib/errors'
import { insertAuditLog } from './employees'
import { invalidateRiskCache } from './risk'

const router = Router()

async function findDeptProfileOr404(tenantDb: any, tenantId: string, department: string) {
  const rows = await tenantDb.$queryRaw<any[]>`
    SELECT * FROM department_risk_profiles WHERE tenant_id = ${tenantId} AND department = ${department} LIMIT 1
  `
  if (!rows[0]) throw new AppError(404, `Sin perfil de riesgo para el departamento "${department}"`)
  return rows[0]
}

// ── GET /api/risk/departments ─────────────────────────────────

router.get('/departments', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const rows = await req.tenantDb.$queryRaw<any[]>`
      SELECT * FROM department_risk_profiles WHERE tenant_id = ${tenantId} ORDER BY department
    `
    res.json({ departments: rows })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/risk/departments/:dept ───────────────────────────

router.get('/departments/:dept', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const profile = await findDeptProfileOr404(req.tenantDb, req.tenant.id, req.params.dept)
    res.json(profile)
  } catch (err) {
    next(err)
  }
})

// ── PATCH /api/risk/departments/:dept ─────────────────────────

const patchSchema = z.object({
  perfilOptimo:           z.record(z.any()).optional(),
  riesgosOcupacionales:   z.array(z.any()).optional(),
  historialAccidentes:    z.array(z.any()).optional(),
  alertasAutomaticas:     z.array(z.any()).optional(),
})

const PATCH_COLUMN_MAP: Record<string, string> = {
  perfilOptimo:         'perfil_optimo',
  riesgosOcupacionales: 'riesgos_ocupacionales',
  historialAccidentes:  'historial_accidentes',
  alertasAutomaticas:   'alertas_automaticas',
}

router.patch('/departments/:dept', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = patchSchema.parse(req.body)
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb
    const department = req.params.dept

    const entries = Object.entries(input).filter(([, v]) => v !== undefined) as [string, unknown][]
    if (entries.length === 0) throw new AppError(400, 'No se enviaron campos para actualizar')

    // Upsert en 2 pasos — igual que health_profiles (ver PATCH /:id/health).
    await tenantDb.$executeRaw`
      INSERT INTO department_risk_profiles (tenant_id, department) VALUES (${tenantId}, ${department})
      ON CONFLICT (tenant_id, department) DO NOTHING
    `

    const setFragments = entries.map(([k, v]) =>
      Prisma.sql`${Prisma.raw(PATCH_COLUMN_MAP[k])} = ${JSON.stringify(v)}::jsonb`
    )
    setFragments.push(Prisma.sql`ultima_revision = CURRENT_DATE`)
    setFragments.push(Prisma.sql`updated_by = ${req.jwt.email}`)

    const rows = await tenantDb.$queryRaw<any[]>`
      UPDATE department_risk_profiles SET ${Prisma.join(setFragments, ', ')}
      WHERE tenant_id = ${tenantId} AND department = ${department}
      RETURNING *
    `
    const profile = rows[0]

    await insertAuditLog(tenantDb, tenantId, req, 'dept_risk_profile.updated', `department:${department}`, { fields: Object.keys(input) })
    await invalidateRiskCache(tenantId).catch(() => {})

    res.json(profile)
  } catch (err) {
    next(err)
  }
})

// ── POST /api/risk/departments/:dept/accidente ────────────────

const accidenteSchema = z.object({
  fecha:       z.string(),  // ISO date
  tipo:        z.string().min(1),
  severidad:   z.enum(['leve', 'moderado', 'grave']),
  descripcion: z.string().min(1),
  employeeId:  z.string().optional(),
})

router.post('/departments/:dept/accidente', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = accidenteSchema.parse(req.body)
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb
    const department = req.params.dept

    await tenantDb.$executeRaw`
      INSERT INTO department_risk_profiles (tenant_id, department) VALUES (${tenantId}, ${department})
      ON CONFLICT (tenant_id, department) DO NOTHING
    `

    const accidente = {
      id: crypto.randomUUID(),
      fecha: input.fecha,
      tipo: input.tipo,
      severidad: input.severidad,
      descripcion: input.descripcion,
      employeeId: input.employeeId ?? null,
      registradoPor: req.jwt.email,
      registradoEn: new Date().toISOString(),
    }

    const rows = await tenantDb.$queryRaw<any[]>`
      UPDATE department_risk_profiles
      SET historial_accidentes = historial_accidentes || jsonb_build_array(${JSON.stringify(accidente)}::jsonb),
          ultima_revision = CURRENT_DATE,
          updated_by = ${req.jwt.email}
      WHERE tenant_id = ${tenantId} AND department = ${department}
      RETURNING *
    `
    const profile = rows[0]

    await insertAuditLog(tenantDb, tenantId, req, 'dept_risk_profile.accidente_registrado', `department:${department}`, { accidente })
    await invalidateRiskCache(tenantId).catch(() => {})

    res.status(201).json(profile)
  } catch (err) {
    next(err)
  }
})

export default router

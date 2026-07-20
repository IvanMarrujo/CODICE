// ============================================================
// CÓDICE · Actas administrativas — testigo digital
// Cadena de custodia inmutable para actas (amonestación, suspensión,
// baja) firmadas por el colaborador + 2 testigos + RH, con hash SHA256,
// IP, dispositivo y geolocalización por firma — pensado para sostenerse
// ante tribunales JFCA.
//
// Dos routers en este archivo:
//   - `publicRouter` (export nombrado): /sign/:token, /sign/:token/decline,
//     /verify/:hash — SIN auth de tenant (el firmante nunca hizo login).
//     Se monta en index.ts ANTES del pipeline authMiddleware/tenantMiddleware,
//     igual que webhook.ts. El tenant se resuelve del propio JWT del token
//     de firma (ver tenantCtxFromId), no de un login de admin/colaborador.
//   - `router` (export default): CRUD normal, requireHR, detrás del
//     pipeline autenticado — igual que el resto de las rutas.
// ============================================================

import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import * as crypto from 'crypto'
import jwt from 'jsonwebtoken'
import QRCode from 'qrcode'
import { requireHR } from '../middleware/auth'
import { AppError } from '../lib/errors'
import { prismaPublic } from '../lib/prisma'
import { getTenantPrisma } from '../middleware/tenant'
import { htmlToPdf } from '../lib/pdf'
import { savePdf } from '../lib/storage'
import { WEBHOOK_SECRET } from './webhook'
import { sendWhatsApp } from '../lib/whatsapp'

const router = Router()
const publicRouter = Router()

// ── Constantes / helpers compartidos ──────────────────────────

const ACTA_SIGN_EXPIRES = '48h'

const SIGNATURE_ROLES = ['subject', 'witness_1', 'witness_2', 'hr_manager'] as const
type SignatureRole = typeof SIGNATURE_ROLES[number]

const ROLE_LABEL: Record<SignatureRole, string> = {
  subject:    'Colaborador',
  witness_1:  'Testigo 1',
  witness_2:  'Testigo 2',
  hr_manager: 'RH',
}

// Estatus del acta — mismo vocabulario ya documentado en tenant-schema.sql
// (Borrador | Firmada | Impugnada | Archivada), NO en mayúsculas — para no
// introducir una segunda convención en una columna que ya existía.
const ACTA_STATUS = { BORRADOR: 'Borrador', FIRMADA: 'Firmada' } as const

interface ActaSignJWT {
  purpose:    'acta-sign'
  actaId:     string
  tenantId:   string
  employeeId: string | null
  role:       SignatureRole
}

function signActaToken(payload: Omit<ActaSignJWT, 'purpose'>): string {
  return jwt.sign({ purpose: 'acta-sign', ...payload }, process.env.JWT_SECRET!, {
    expiresIn: ACTA_SIGN_EXPIRES,
  } as jwt.SignOptions)
}

function verifyActaToken(token: string): ActaSignJWT {
  let payload: any
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET!)
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') throw new AppError(401, 'Este enlace de firma expiró (48h). Pide a RH que genere uno nuevo.')
    throw new AppError(401, 'Enlace de firma inválido')
  }
  if (payload.purpose !== 'acta-sign') throw new AppError(401, 'Enlace de firma inválido')
  return payload as ActaSignJWT
}

// Resuelve tenant + tenantDb a partir del tenantId embebido en el token de
// firma — el firmante nunca hizo login, así que no hay req.tenant/tenantDb
// (esos los pone tenantMiddleware a partir de un JWT de sesión real).
async function tenantCtxFromId(tenantId: string) {
  const tenant = await prismaPublic.tenant.findUnique({ where: { id: tenantId } })
  if (!tenant) throw new AppError(404, 'Tenant no encontrado')
  const tenantDb = await getTenantPrisma(tenant.dbSchema)
  await tenantDb.$executeRawUnsafe(`SET search_path = "${tenant.dbSchema}", public`)
  return { tenant, tenantDb }
}

function signatureHash(actaId: string, employeeId: string | null, signedAt: Date): string {
  return crypto.createHash('sha256')
    .update(`${actaId}:${employeeId ?? 'hr'}:${signedAt.toISOString()}:${WEBHOOK_SECRET}`)
    .digest('hex')
}

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:5173').replace(/\/$/, '')
const API_URL = (process.env.PUBLIC_API_URL || 'https://codice-api-production.up.railway.app').replace(/\/$/, '')

function signingUrlFor(token: string): string {
  return `${APP_URL}/acta-firma/${token}`
}

function emitActaSigned(req: Request, tenantId: string, payload: unknown) {
  const io = req.app.get('io')
  io?.to(`tenant:${tenantId}`).emit('acta:signed', payload)
}

// ── POST /api/actas ───────────────────────────────────────────
// Crea el acta + 4 slots de firma. RH queda auto-firmado de inmediato
// (firma server-side, no hay "dispositivo" real — se deja constancia en
// device_info de quién la generó en vez de un User-Agent).

const createActaSchema = z.object({
  employeeId:  z.string().min(1),
  type:        z.string().min(1),
  description: z.string().min(1),
  witnesses:   z.array(z.string().min(1)).length(2),
  incidentDate: z.string().optional(),
})

router.post('/', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createActaSchema.parse(req.body)
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb

    const employee = await tenantDb.$queryRaw<any[]>`
      SELECT id, full_name FROM employees WHERE id = ${input.employeeId} AND tenant_id = ${tenantId} LIMIT 1
    `
    if (!employee[0]) throw new AppError(404, 'Colaborador no encontrado')

    const [w1, w2] = await Promise.all(input.witnesses.map((id) =>
      tenantDb.$queryRaw<any[]>`SELECT id, full_name FROM employees WHERE id = ${id} AND tenant_id = ${tenantId} LIMIT 1`
    ))
    if (!w1[0] || !w2[0]) throw new AppError(404, 'Uno o ambos testigos no se encontraron')

    // Folio legible tipo "GFP-ACTA-0031" — secuencial por tenant.
    const countRow = await tenantDb.$queryRaw<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM actas WHERE tenant_id = ${tenantId}`
    const seq = (countRow[0]?.count ?? 0) + 1
    const folio = `${req.tenant.slug.toUpperCase()}-ACTA-${String(seq).padStart(4, '0')}`

    const actaRows = await tenantDb.$queryRaw<any[]>`
      INSERT INTO actas (tenant_id, employee_id, folio, type, reason, incident_date, issue_date, status, issued_by, witness_1, witness_2)
      VALUES (${tenantId}, ${input.employeeId}, ${folio}, ${input.type}, ${input.description},
              ${input.incidentDate ?? null}::date, CURRENT_DATE, ${ACTA_STATUS.BORRADOR}, ${req.jwt.sub},
              ${w1[0].full_name}, ${w2[0].full_name})
      RETURNING *
    `
    const acta = actaRows[0]

    const now = new Date()
    const hrSignedAt = now
    const hrHash = signatureHash(acta.id, null, hrSignedAt)

    // hr_manager: auto-firmado al crear. Sin employee_id (RH no siempre tiene
    // fila en `employees` — es un AdminUser, tabla distinta) — la identidad
    // se deja en device_info en vez del User-Agent que sí tienen las otras 3.
    await tenantDb.$executeRaw`
      INSERT INTO acta_signatures (acta_id, employee_id, role, signed_at, signature_hash, device_info)
      VALUES (${acta.id}, NULL, 'hr_manager', ${hrSignedAt}, ${hrHash}, ${`Firmado automáticamente por ${req.jwt.email} (RH) al crear el acta`})
    `

    const slots: { role: SignatureRole; employeeId: string }[] = [
      { role: 'subject',   employeeId: input.employeeId },
      { role: 'witness_1', employeeId: input.witnesses[0] },
      { role: 'witness_2', employeeId: input.witnesses[1] },
    ]
    const signingUrls: Record<string, string> = {}
    for (const slot of slots) {
      await tenantDb.$executeRaw`
        INSERT INTO acta_signatures (acta_id, employee_id, role)
        VALUES (${acta.id}, ${slot.employeeId}, ${slot.role})
      `
      const token = signActaToken({ actaId: acta.id, tenantId, employeeId: slot.employeeId, role: slot.role })
      signingUrls[slot.role] = signingUrlFor(token)
    }

    await tenantDb.$executeRaw`UPDATE actas SET signature_count = 1 WHERE id = ${acta.id}`

    res.status(201).json({ acta: { ...acta, signature_count: 1 }, signingUrl: signingUrls.subject, signingUrls })
  } catch (err) {
    next(err)
  }
})

// ── Helper: detalle completo de un acta + sus firmas ──────────

async function fetchActaDetail(tenantDb: any, tenantId: string, actaId: string) {
  const rows = await tenantDb.$queryRaw<any[]>`
    SELECT a.*, e.full_name AS employee_name, e.position AS employee_position, e.department AS employee_department
    FROM actas a
    LEFT JOIN employees e ON e.id = a.employee_id
    WHERE a.id = ${actaId} AND a.tenant_id = ${tenantId}
    LIMIT 1
  `
  const acta = rows[0]
  if (!acta) throw new AppError(404, 'Acta no encontrada')

  const sigRows = await tenantDb.$queryRaw<any[]>`
    SELECT s.*, e.full_name AS employee_name, e.phone AS employee_phone
    FROM acta_signatures s
    LEFT JOIN employees e ON e.id = s.employee_id
    WHERE s.acta_id = ${actaId}
  `
  const signatures = SIGNATURE_ROLES.map((role) => {
    const row = sigRows.find((s: any) => s.role === role)
    return {
      role,
      label:      ROLE_LABEL[role],
      employeeId: row?.employee_id ?? null,
      name:       row?.employee_name ?? (role === 'hr_manager' ? row?.device_info?.split(' por ')[1]?.split(' (')[0] ?? 'RH' : null),
      phone:      row?.employee_phone ?? null,
      signedAt:   row?.signed_at ?? null,
      declined:   row?.declined ?? false,
      declinedReason: row?.declined_reason ?? null,
      hash:       row?.signature_hash ?? null,
      ipAddress:  row?.ip_address ?? null,
      deviceInfo: row?.device_info ?? null,
      // signingUrl fresco (48h desde ahora) para "Copiar link" — no depende
      // de que el original siga vigente ni de guardarlo en DB.
      signingUrl: (!row?.signed_at && role !== 'hr_manager')
        ? signingUrlFor(signActaToken({ actaId, tenantId, employeeId: row?.employee_id ?? null, role }))
        : null,
    }
  })

  return { acta, signatures }
}

// ── GET /api/actas?employeeId=X ───────────────────────────────
// Historial de actas de un colaborador — alimenta la tab ACTAS del
// Expediente (además de la card de la que se acaba de crear).

router.get('/', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const employeeId = req.query.employeeId ? String(req.query.employeeId) : null

    const rows = await req.tenantDb.$queryRaw<any[]>`
      SELECT id, folio, type, status, issue_date, signature_count, finalized_at, document_hash
      FROM actas
      WHERE tenant_id = ${tenantId} AND (${employeeId}::text IS NULL OR employee_id = ${employeeId})
      ORDER BY created_at DESC
    `
    res.json({ data: rows })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/actas/:id ────────────────────────────────────────

router.get('/:id', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const detail = await fetchActaDetail(req.tenantDb, req.tenant.id, req.params.id)
    res.json(detail)
  } catch (err) {
    next(err)
  }
})

// ── POST /api/actas/:id/notify/:role ──────────────────────────
// "Enviar por WhatsApp" — reenviable, útil si el primer envío no llegó o
// pasaron las 48h (regenera un token fresco cada vez que se llama).

router.post('/:id/notify/:role', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const role = req.params.role as SignatureRole
    if (!SIGNATURE_ROLES.includes(role) || role === 'hr_manager') throw new AppError(400, 'Rol inválido')

    const { acta, signatures } = await fetchActaDetail(req.tenantDb, req.tenant.id, req.params.id)
    const slot = signatures.find((s) => s.role === role)
    if (!slot) throw new AppError(404, 'Firma no encontrada')
    if (!slot.phone) throw new AppError(400, `${slot.name || 'Este colaborador'} no tiene teléfono registrado`)
    if (slot.signedAt) throw new AppError(409, 'Esta firma ya fue registrada')

    const token = signActaToken({ actaId: acta.id, tenantId: req.tenant.id, employeeId: slot.employeeId, role })
    const url = signingUrlFor(token)
    const message = `📋 CÓDICE · Acta administrativa\nTienes un documento pendiente de firma.\nLéelo y firma aquí: ${url}\nTienes 48 horas para firmarlo.`

    await sendWhatsApp(slot.phone, message, req.tenant.id)

    res.json({ sent: true, signingUrl: url })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/actas/:id/pdf-legal ──────────────────────────────

function fmtDateTime(d: unknown): string {
  if (!d) return '—'
  return new Date(d as string).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
}

async function buildLegalPdfHtml(tenant: { name: string }, acta: any, signatures: any[], verifyUrl: string): Promise<string> {
  const qrDataUrl = await QRCode.toDataURL(verifyUrl, { width: 150, margin: 1 })

  const sigRowsHtml = signatures.map((s) => `
    <tr>
      <td>${s.label}</td>
      <td>${s.declined ? `${s.name || '—'} (inconforme)` : (s.name || '—')}</td>
      <td>${s.signedAt ? fmtDateTime(s.signedAt) : (s.declined ? 'Inconformidad registrada' : 'Pendiente')}</td>
      <td class="mono">${s.hash ? s.hash.slice(0, 16) + '…' : '—'}</td>
      <td class="mono">${s.ipAddress || '—'}</td>
      <td>${s.deviceInfo ? String(s.deviceInfo).slice(0, 40) : '—'}</td>
    </tr>
  `).join('')

  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:Georgia,serif;color:#16202e;max-width:760px;margin:0 auto;padding:36px;line-height:1.6;font-size:13px}
h1{font-size:17px;text-align:center;text-transform:uppercase}
h2{font-size:13px;margin-top:20px;border-bottom:1px solid #ccc;padding-bottom:5px}
table{width:100%;border-collapse:collapse;margin-top:8px;font-size:10.5px}
th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}
th{background:#f2f2f2}
.mono{font-family:monospace}
.footer{margin-top:30px;display:flex;justify-content:space-between;align-items:center;gap:20px}
.footer img{width:110px;height:110px}
.hash{font-size:9.5px;color:#555;word-break:break-all}
</style></head><body>
<h1>Acta Administrativa</h1>
<p style="text-align:center"><b>${tenant.name}</b> · Folio ${acta.folio}</p>
<h2>Datos del acta</h2>
<p><b>Tipo:</b> ${acta.type}<br>
<b>Colaborador:</b> ${acta.employee_name || '—'} (${acta.employee_position || '—'}, ${acta.employee_department || '—'})<br>
<b>Fecha del incidente:</b> ${acta.incident_date ? new Date(acta.incident_date).toLocaleDateString('es-MX') : '—'}<br>
<b>Fecha de emisión:</b> ${new Date(acta.issue_date).toLocaleDateString('es-MX')}</p>
<h2>Descripción de los hechos</h2>
<p>${String(acta.reason).replace(/\n/g, '<br>')}</p>
<h2>Cadena de custodia — firmas digitales</h2>
<table><thead><tr><th>Rol</th><th>Nombre</th><th>Firmado</th><th>Hash</th><th>IP</th><th>Dispositivo</th></tr></thead>
<tbody>${sigRowsHtml}</tbody></table>
<div class="footer">
  <div>
    <p style="margin:0"><b>Documento generado por CÓDICE — cadena de custodia digital</b></p>
    <p class="hash">Hash del documento: ${acta.document_hash || '(pendiente — se calcula al completarse las 4 firmas)'}</p>
  </div>
  <img src="${qrDataUrl}" alt="QR de verificación" />
</div>
</body></html>`
}

router.get('/:id/pdf-legal', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { acta, signatures } = await fetchActaDetail(req.tenantDb, req.tenant.id, req.params.id)
    const verifyUrl = `${API_URL}/api/actas/verify/${acta.document_hash || acta.id}`

    const html = await buildLegalPdfHtml(req.tenant, acta, signatures, verifyUrl)
    const pdfBuffer = await htmlToPdf(html)
    const pdfUrl = await savePdf(`actas/${req.tenant.id}/${acta.id}.pdf`, pdfBuffer)

    await req.tenantDb.$executeRaw`UPDATE actas SET pdf_url = ${pdfUrl} WHERE id = ${acta.id}`

    res.json({ pdfUrl })
  } catch (err) {
    next(err)
  }
})

// ── PUBLIC: GET /api/actas/sign/:token ────────────────────────

publicRouter.get('/sign/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = verifyActaToken(req.params.token)
    const { tenant, tenantDb } = await tenantCtxFromId(payload.tenantId)

    const { acta, signatures } = await fetchActaDetail(tenantDb, tenant.id, payload.actaId)
    const mySignature = signatures.find((s) => s.role === payload.role)
    if (!mySignature) throw new AppError(404, 'Firma no encontrada')

    res.json({
      tenantName: tenant.name,
      acta: {
        folio: acta.folio, type: acta.type, reason: acta.reason,
        incidentDate: acta.incident_date, issueDate: acta.issue_date, status: acta.status,
      },
      role:  payload.role,
      label: ROLE_LABEL[payload.role],
      alreadySigned:  !!mySignature.signedAt,
      alreadyDeclined: mySignature.declined,
      employeeName: mySignature.name,
    })
  } catch (err) {
    next(err)
  }
})

// ── PUBLIC: POST /api/actas/sign/:token ───────────────────────

const signBodySchema = z.object({
  locationLat: z.number().optional(),
  locationLng: z.number().optional(),
  locationMock: z.boolean().optional(),
})

publicRouter.post('/sign/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = verifyActaToken(req.params.token)
    const input = signBodySchema.parse(req.body)
    const { tenant, tenantDb } = await tenantCtxFromId(payload.tenantId)

    const existing = await tenantDb.$queryRaw<any[]>`
      SELECT * FROM acta_signatures WHERE acta_id = ${payload.actaId} AND role = ${payload.role} LIMIT 1
    `
    if (!existing[0]) throw new AppError(404, 'Firma no encontrada')
    if (existing[0].signed_at) throw new AppError(409, 'Esta firma ya fue registrada')

    const signedAt = new Date()
    const hash = signatureHash(payload.actaId, payload.employeeId, signedAt)
    const ip = req.ip
    const device = req.headers['user-agent'] || null

    await tenantDb.$executeRaw`
      UPDATE acta_signatures SET
        signed_at = ${signedAt}, signature_hash = ${hash}, ip_address = ${ip}, device_info = ${device},
        location_lat = ${input.locationLat ?? null}, location_lng = ${input.locationLng ?? null},
        location_mock = ${input.locationMock ?? true}
      WHERE acta_id = ${payload.actaId} AND role = ${payload.role}
    `

    const countRow = await tenantDb.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM acta_signatures WHERE acta_id = ${payload.actaId} AND signed_at IS NOT NULL
    `
    const signedCount = countRow[0]?.count ?? 0
    await tenantDb.$executeRaw`UPDATE actas SET signature_count = ${signedCount} WHERE id = ${payload.actaId}`

    let finalized = false
    let documentHash: string | null = null
    if (signedCount >= SIGNATURE_ROLES.length) {
      const allSigs = await tenantDb.$queryRaw<any[]>`
        SELECT role, signature_hash FROM acta_signatures WHERE acta_id = ${payload.actaId} ORDER BY role
      `
      documentHash = crypto.createHash('sha256')
        .update(`${payload.actaId}:${allSigs.map((s: any) => s.signature_hash).join(':')}`)
        .digest('hex')
      await tenantDb.$executeRaw`
        UPDATE actas SET status = ${ACTA_STATUS.FIRMADA}, finalized_at = NOW(), document_hash = ${documentHash}
        WHERE id = ${payload.actaId}
      `
      finalized = true
    }

    emitActaSigned(req, tenant.id, {
      actaId: payload.actaId, role: payload.role, signedAt, finalized, signatureCount: signedCount,
    })

    res.json({
      folio: (await tenantDb.$queryRaw<any[]>`SELECT folio FROM actas WHERE id = ${payload.actaId}`)[0]?.folio,
      signedAt, hash, finalized, documentHash,
    })
  } catch (err) {
    next(err)
  }
})

// ── PUBLIC: POST /api/actas/sign/:token/decline ───────────────

const declineBodySchema = z.object({ reason: z.string().optional() })

publicRouter.post('/sign/:token/decline', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = verifyActaToken(req.params.token)
    const { reason } = declineBodySchema.parse(req.body)
    const { tenant, tenantDb } = await tenantCtxFromId(payload.tenantId)

    const existing = await tenantDb.$queryRaw<any[]>`
      SELECT * FROM acta_signatures WHERE acta_id = ${payload.actaId} AND role = ${payload.role} LIMIT 1
    `
    if (!existing[0]) throw new AppError(404, 'Firma no encontrada')
    if (existing[0].signed_at || existing[0].declined) throw new AppError(409, 'Esta firma ya fue registrada')

    // La inconformidad SÍ deja huella (fecha, IP, dispositivo) aunque no
    // cuenta como firma — no avanza signature_count ni bloquea el acta.
    await tenantDb.$executeRaw`
      UPDATE acta_signatures SET
        declined = true, declined_reason = ${reason ?? null},
        ip_address = ${req.ip}, device_info = ${req.headers['user-agent'] || null}
      WHERE acta_id = ${payload.actaId} AND role = ${payload.role}
    `

    emitActaSigned(req, tenant.id, { actaId: payload.actaId, role: payload.role, declined: true })

    res.json({ declined: true })
  } catch (err) {
    next(err)
  }
})

// ── PUBLIC: GET /api/actas/verify/:hash ───────────────────────
// El QR del PDF legal apunta acá. Sin tenant conocido de antemano — busca
// entre los tenants provisionados (en este demo son pocos; a escala real se
// indexaría document_hash en una tabla pública, pero no se agregó esa tabla
// extra sin que se pidiera explícitamente).

publicRouter.get('/verify/:hash', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const hash = req.params.hash
    const tenants = await prismaPublic.tenant.findMany({ select: { id: true, dbSchema: true, name: true } })

    for (const t of tenants) {
      const tenantDb = await getTenantPrisma(t.dbSchema)
      await tenantDb.$executeRawUnsafe(`SET search_path = "${t.dbSchema}", public`)
      const rows = await tenantDb.$queryRaw<any[]>`
        SELECT id, folio, type, status, finalized_at, document_hash FROM actas
        WHERE document_hash = ${hash} OR id = ${hash} LIMIT 1
      `
      if (rows[0]) {
        const sigRows = await tenantDb.$queryRaw<any[]>`
          SELECT role, signed_at, declined FROM acta_signatures WHERE acta_id = ${rows[0].id} ORDER BY role
        `
        return res.json({
          valid: !!rows[0].document_hash,
          acta: {
            folio: rows[0].folio, type: rows[0].type, status: rows[0].status,
            finalizedAt: rows[0].finalized_at, tenantName: t.name,
          },
          signatures: sigRows.map((s: any) => ({ role: s.role, signed: !!s.signed_at, declined: s.declined })),
        })
      }
    }

    res.json({ valid: false, acta: null, signatures: [] })
  } catch (err) {
    next(err)
  }
})

export { publicRouter as actaPublicRoutes }
export default router

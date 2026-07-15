// ============================================================
// CÓDICE · Admin routes
// Perfil del admin autenticado (para el número de WhatsApp, etc).
// ============================================================

import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { requireHR } from '../middleware/auth'
import { prismaPublic } from '../lib/prisma'
import { AppError } from '../lib/errors'
import { r2Configured } from '../lib/storage'
import { htmlToPdf } from '../lib/pdf'

const router = Router()

router.get('/', (req, res) => res.json({ route: 'admin', status: 'ok' }))

// ── GET /api/admin/profile ──────────────────────────────────────

router.get('/profile', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const admin = await prismaPublic.adminUser.findUnique({
      where:  { id: req.jwt.sub },
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, role: true },
    })
    if (!admin) throw new AppError(404, 'Usuario no encontrado')
    res.json(admin)
  } catch (err) {
    next(err)
  }
})

// ── PATCH /api/admin/profile ────────────────────────────────────

const profilePatchSchema = z.object({
  phone:     z.string().nullable().optional(),
  firstName: z.string().min(1).optional(),
  lastName:  z.string().min(1).optional(),
})

router.patch('/profile', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = profilePatchSchema.parse(req.body)
    const entries = Object.entries(input).filter(([, v]) => v !== undefined)
    if (entries.length === 0) throw new AppError(400, 'No se enviaron campos para actualizar')

    const admin = await prismaPublic.adminUser.update({
      where: { id: req.jwt.sub },
      data:  Object.fromEntries(entries),
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, role: true },
    })
    res.json(admin)
  } catch (err) {
    next(err)
  }
})

// ── GET /api/admin/storage-status ───────────────────────────────

router.get('/storage-status', requireHR, (req: Request, res: Response) => {
  const configured = r2Configured()
  res.json({
    r2Configured: configured,
    tmpFallback:  !configured,
    warning: configured ? undefined : 'Almacenamiento temporal activo — los archivos PDF se perderán al reiniciar el servidor. Configura almacenamiento permanente.',
  })
})

// ── GET /api/admin/nda-preview ──────────────────────────────────
// Genera un NDA de piloto pre-llenado con los datos del tenant.

function ndaHtml(tenantName: string, todayLabel: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Georgia,serif;color:#16202e;max-width:720px;margin:0 auto;padding:40px;line-height:1.65;font-size:12.5px}
    h1{font-size:17px;text-align:center;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px}
    .sub{text-align:center;color:#5b6b80;font-size:11px;margin-bottom:28px}
    h2{font-size:12.5px;margin-top:22px;border-bottom:1px solid #ccc;padding-bottom:5px;text-transform:uppercase;letter-spacing:.03em}
    .meta{font-size:11.5px;color:#444}
    ul{margin:6px 0;padding-left:20px}
    .sign{margin-top:56px;display:flex;justify-content:space-between;gap:40px}
    .sign div{flex:1;text-align:center;border-top:1px solid #16202e;padding-top:8px;font-size:11px}
  </style></head><body>
    <h1>Acuerdo de Confidencialidad y Piloto</h1>
    <div class="sub">Generado el ${todayLabel} · CÓDICE por Auspex</div>

    <h2>Partes</h2>
    <div class="meta">
      <strong>AUSPEX</strong> ("el Proveedor"), desarrollador y titular de la plataforma CÓDICE.<br/>
      <strong>${tenantName}</strong> ("el Cliente"), en adelante conjuntamente "las Partes".
    </div>

    <h2>Objeto</h2>
    <p>Las Partes acuerdan iniciar un periodo piloto de evaluación de la plataforma CÓDICE por un plazo de
    <strong>90 (noventa) días naturales</strong>, sin costo para el Cliente, con el fin de evaluar su funcionalidad
    y adecuación a los procesos de Recursos Humanos del Cliente.</p>

    <h2>Confidencialidad</h2>
    <p>Toda información de empleados del Cliente procesada por CÓDICE durante el piloto (datos personales,
    nómina, expedientes, documentos médicos y demás información sensible) será tratada como estrictamente
    confidencial y conforme a la Ley Federal de Protección de Datos Personales en Posesión de los Particulares
    (LFPDPPP), incluyendo su Artículo 8 sobre consentimiento para el tratamiento de datos personales.</p>

    <h2>Alcance</h2>
    <p><strong>Incluye:</strong></p>
    <ul>
      <li>Acceso a los módulos de Plantilla, Nómina, Solicitudes, Asistencia, Capacitación y Perfil de Salud.</li>
      <li>Soporte técnico durante el periodo piloto.</li>
      <li>Migración inicial de datos existentes del Cliente (Excel, DBF o CFDI de nómina).</li>
    </ul>
    <p><strong>No incluye:</strong></p>
    <ul>
      <li>Desarrollo de funcionalidades a la medida fuera del alcance estándar de CÓDICE.</li>
      <li>Garantías de disponibilidad (SLA) formales — aplican únicamente en contratos posteriores al piloto.</li>
      <li>Integraciones con sistemas de terceros no contempladas expresamente por escrito.</li>
    </ul>

    <h2>Propiedad intelectual</h2>
    <p>La plataforma CÓDICE, su código fuente, diseño, marca y toda propiedad intelectual asociada son y
    seguirán siendo propiedad exclusiva de AUSPEX. El Cliente conserva en todo momento la propiedad de sus
    propios datos.</p>

    <h2>Vigencia</h2>
    <p>El presente acuerdo tiene una vigencia de 90 días naturales a partir de su firma, prorrogable por
    acuerdo escrito entre las Partes.</p>

    <h2>Jurisdicción</h2>
    <p>Para la interpretación y cumplimiento del presente acuerdo, las Partes se someten a las leyes
    aplicables y tribunales competentes de la Ciudad de México, renunciando a cualquier otro fuero que
    pudiera corresponderles.</p>

    <div class="sign">
      <div>AUSPEX<br/>Proveedor</div>
      <div>${tenantName}<br/>Cliente</div>
    </div>
  </body></html>`
}

router.get('/nda-preview', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const todayLabel = new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })
    const html = ndaHtml(req.tenant.name, todayLabel)
    const pdfBuffer = await htmlToPdf(html)

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="nda-codice-${req.tenant.slug}.pdf"`)
    res.send(pdfBuffer)
  } catch (err) {
    next(err)
  }
})

export default router

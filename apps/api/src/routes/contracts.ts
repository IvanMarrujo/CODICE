// ============================================================
// CÓDICE · Contracts routes
// POST /:id/pdf — renderiza el contrato (HTML guardado o plantilla
// LFT de respaldo) a PDF con Puppeteer y lo guarda en R2/tmp.
// ============================================================

import { Router, Request, Response, NextFunction, RequestHandler } from 'express'
import { z } from 'zod'
import multer from 'multer'
import * as path from 'path'
import * as crypto from 'crypto'
import Anthropic from '@anthropic-ai/sdk'
import { requireHR } from '../middleware/auth'
import { AppError }  from '../lib/errors'
import { htmlToPdf } from '../lib/pdf'
import { savePdf, saveFile }   from '../lib/storage'

const router = Router()

// ── IA para análisis de machotes (Feature 4) ─────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const AI_MODEL  = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5'
const TEMPLATE_BUCKET = 'contract-templates'

// Quita fences ```json ... ``` que a veces envuelven la respuesta del modelo.
function stripJsonFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
}

router.get('/', (req, res) => res.json({ route: 'contracts', status: 'ok' }))

// ── GET /api/contracts/expiring-soon ─────────────────────────
// Contratos con end_date dentro de los próximos 30 días — alimenta la
// alerta proactiva del asistente flotante (Feature 1, "outbreak de energía").

router.get('/expiring-soon', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const rows = await req.tenantDb.$queryRaw<any[]>`
      SELECT e.full_name, c.end_date
      FROM contracts c
      JOIN employees e ON e.id = c.employee_id
      WHERE c.tenant_id = ${tenantId} AND c.end_date BETWEEN NOW() AND NOW() + INTERVAL '30 days'
      ORDER BY c.end_date ASC
      LIMIT 20
    `
    const contracts = rows.map((r: any) => ({
      fullName: r.full_name,
      endDate:  r.end_date,
      daysLeft: Math.max(0, Math.ceil((new Date(r.end_date).getTime() - Date.now()) / 86400000)),
    }))
    res.json({ contracts })
  } catch (err) {
    next(err)
  }
})

const mxn = (n: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(Math.round(n))
const mxn2 = (n: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 2 }).format(n)
const fmtDate = (d: unknown) => d ? new Date(d as string).toISOString().slice(0, 10) : '[fecha]'

const DURACION_TEXT: Record<string, (desc: string) => string> = {
  'Indeterminado':       () => 'El presente contrato se celebra por <b>tiempo indeterminado</b>, en términos del artículo 35 de la LFT.',
  'Determinado':         (d) => `El presente contrato se celebra por <b>tiempo determinado</b> con vigencia de <b>${d || '[duración]'}</b> (art. 37 LFT), justificándose la temporalidad por la naturaleza del trabajo.`,
  'Obra/Proyecto':       (d) => `El presente contrato se celebra <b>por obra o proyecto determinado</b> (${d || '[duración]'}), conforme al artículo 36 de la LFT.`,
  'Periodo de prueba':   () => 'El presente contrato incluye un <b>periodo de prueba</b> que no excederá de 30 días (180 para dirección/técnicos), conforme al artículo 39-A de la LFT.',
  'Capacitación inicial': (d) => `El presente contrato es <b>de capacitación inicial</b> por ${d || '[duración]'} (máx. 3 meses; 6 para dirección/técnicos), conforme al artículo 39-B de la LFT.`,
}

// Plantilla LFT de respaldo — se usa cuando el contrato no trae html_content propio
// (generado por el front-end). Replica el mismo modelo legal usado ahí.
function buildContractHtml(tenantName: string, c: any): string {
  const salario = Number(c.monthly_salary ?? 0)
  const sd = salario / 30
  const durFn = DURACION_TEXT[c.contract_type] || DURACION_TEXT['Indeterminado']
  const nombreTrabajador = c.full_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || '[Nombre del trabajador]'

  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:Georgia,serif;color:#16202e;max-width:720px;margin:0 auto;padding:36px;line-height:1.65;font-size:13.5px}
h1{font-size:17px;text-align:center;text-transform:uppercase}
h2{font-size:13px;margin-top:22px;border-bottom:1px solid #ccc;padding-bottom:5px}
.meta{font-size:12px;color:#555}
.sign{margin-top:54px;display:flex;justify-content:space-between;gap:40px}
.sign div{flex:1;text-align:center;border-top:1px solid #16202e;padding-top:8px;font-size:11px}
</style></head><body>
<h1>Contrato Individual de Trabajo</h1>
<p class="meta">Que celebran por una parte <b>${tenantName}</b> (el "Patrón"), y por la otra <b>${nombreTrabajador}</b> (el "Trabajador"), al amparo de la Ley Federal del Trabajo (LFT).</p>
<h2>Primera — Objeto y puesto</h2><p>El Trabajador desempeñará el puesto de <b>${c.position || '[puesto]'}</b>, con centro de trabajo en <b>${c.plant || '[planta]'}</b>.</p>
<h2>Segunda — Duración</h2><p>${durFn(c.duration_desc)} Inicio: <b>${fmtDate(c.start_date)}</b>.</p>
<h2>Tercera — Jornada</h2><p>La jornada se sujeta a la reforma 2026: máximo <b>48h semanales en 2026</b>, disminuyendo hasta <b>40h en 2030</b> (8h diarias máximo), sin reducción de salario, con <b>registro electrónico de jornada</b>. El tiempo extraordinario se cubre conforme a los arts. 66–68 LFT.</p>
<h2>Cuarta — Salario</h2><p>Salario mensual de <b>${mxn(salario)}</b> (diario ${mxn2(sd)}), pagadero conforme al art. 88 LFT.</p>
<h2>Quinta — Prestaciones de ley</h2><p>Aguinaldo de 15 días (art. 87); vacaciones (art. 76: 12 días el primer año, hasta 20 al quinto); prima vacacional del 25% (art. 80); descanso semanal y obligatorios (arts. 69 y 74); IMSS, INFONAVIT y SAR.</p>
<h2>Sexta — Inocuidad y confidencialidad</h2><p>El Trabajador observará las normas de inocuidad alimentaria, seguridad e higiene aplicables y guardará reserva de la información del Patrón.</p>
<h2>Séptima — Disposiciones finales</h2><p>En lo no previsto se estará a la LFT. Las partes firman de conformidad.</p>
<div class="sign"><div>El Patrón<br>${tenantName}</div><div>El Trabajador<br>${nombreTrabajador}</div></div>
<p style="margin-top:30px;font-size:10px;color:#888">Generado por CÓDICE · Plantilla referencial. Validar con asesoría jurídica antes de su uso.</p>
</body></html>`
}

router.post('/:id/pdf', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb

    const rows = await tenantDb.$queryRaw<any[]>`
      SELECT c.*, e.first_name, e.last_name, e.full_name
      FROM contracts c
      LEFT JOIN employees e ON e.id = c.employee_id
      WHERE c.id = ${req.params.id} AND c.tenant_id = ${tenantId}
      LIMIT 1
    `
    const contract = rows[0]
    if (!contract) throw new AppError(404, 'Contrato no encontrado')

    const html = contract.html_content || buildContractHtml(req.tenant.name, contract)
    const pdfBuffer = await htmlToPdf(html)
    const pdfUrl = await savePdf(`contracts/${tenantId}/${contract.id}.pdf`, pdfBuffer)

    await tenantDb.$executeRaw`UPDATE contracts SET pdf_url = ${pdfUrl} WHERE id = ${contract.id}`

    res.json({ pdfUrl })
  } catch (err) {
    next(err)
  }
})

// ============================================================
// Feature 4 · BIBLIOTECA DE MACHOTES (contract_templates)
// ============================================================

const ALLOWED_TPL_EXT = new Set(['.pdf', '.docx'])
const ALLOWED_TPL_MIME: Record<string, string> = {
  '.pdf':  'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

const TEMPLATE_SYSTEM_PROMPT = `Eres un experto en contratos laborales mexicanos. \
Analiza este contrato/machote y extrae:
- Tipo de contrato
- Puesto/categoría al que aplica
- Cláusulas principales (lista)
- Campos variables que necesitan llenarse (ej: {NOMBRE}, {SALARIO})
- Disposiciones especiales o cláusulas no estándar
Responde ONLY in JSON:
{ "tipo": string, "puestoAplica": string, "clausulasPrincipales": string[], "camposVariables": string[], "disposicionesEspeciales": string[], "resumen": string }`

const tplAnalysisSchema = z.object({
  tipo: z.string().optional().default(''),
  puestoAplica: z.union([z.string(), z.array(z.string())]).optional().default(''),
  clausulasPrincipales: z.array(z.string()).optional().default([]),
  camposVariables: z.array(z.string()).optional().default([]),
  disposicionesEspeciales: z.array(z.string()).optional().default([]),
  resumen: z.string().optional().default(''),
})

// Analiza un PDF de machote con Claude. DOCX no se lee nativo con el modelo,
// así que se almacena y se devuelve un análisis vacío para llenado manual.
async function analyzeTemplate(buffer: Buffer, ext: string, filename: string) {
  if (ext !== '.pdf') return null
  const base64 = buffer.toString('base64')
  const response = await anthropic.beta.messages.create({
    model: AI_MODEL,
    max_tokens: 1500,
    system: TEMPLATE_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: `Analiza este machote de contrato: ${filename}` },
      ],
    }],
  })
  const textBlock = response.content.find((b: any) => b.type === 'text') as { text: string } | undefined
  if (!textBlock) return null
  return tplAnalysisSchema.parse(JSON.parse(stripJsonFences(textBlock.text)))
}

const tplUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (!ALLOWED_TPL_EXT.has(ext)) return cb(new AppError(400, `Tipo no soportado: solo PDF o DOCX`))
    cb(null, true)
  },
}).single('file')

function handleTplUpload(req: Request, res: Response, next: NextFunction) {
  (tplUpload as RequestHandler)(req, res, (err: any) => {
    if (!err) return next()
    if (err instanceof multer.MulterError) {
      return next(new AppError(400, err.code === 'LIMIT_FILE_SIZE' ? 'El archivo supera 10MB' : err.message))
    }
    next(err)
  })
}

// ── POST /api/contracts/templates/upload ─────────────────────
// Sube el machote, lo analiza con IA y crea un registro pre-llenado para
// que RH edite los campos antes de finalizar (PATCH).
router.post('/templates/upload', requireHR, handleTplUpload, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb
    const file = req.file as Express.Multer.File | undefined
    if (!file) throw new AppError(400, 'No se subió ningún archivo')

    const ext = path.extname(file.originalname).toLowerCase()
    const key = `${tenantId}/${crypto.randomUUID()}${ext}`
    await saveFile(key, file.buffer, ALLOWED_TPL_MIME[ext] || file.mimetype, TEMPLATE_BUCKET)

    let analysis: z.infer<typeof tplAnalysisSchema> | null = null
    try { analysis = await analyzeTemplate(file.buffer, ext, file.originalname) }
    catch (e: any) { console.error('[contracts] análisis IA falló:', e.message) }

    const puestoAplica = analysis
      ? (Array.isArray(analysis.puestoAplica) ? analysis.puestoAplica : [analysis.puestoAplica].filter(Boolean))
      : []
    const nombre = file.originalname.replace(/\.(pdf|docx)$/i, '')

    const rows = await tenantDb.$queryRaw<any[]>`
      INSERT INTO contract_templates
        (tenant_id, nombre, tipo, puesto_aplica, clausulas, campos_variables, disposiciones, archivo_url, ia_analysis, created_by)
      VALUES (
        ${tenantId}, ${nombre}, ${analysis?.tipo || null},
        ${JSON.stringify(puestoAplica)}::jsonb,
        ${JSON.stringify(analysis?.clausulasPrincipales || [])}::jsonb,
        ${JSON.stringify(analysis?.camposVariables || [])}::jsonb,
        ${(analysis?.disposicionesEspeciales || []).join('\n') || null},
        ${key}, ${analysis ? JSON.stringify(analysis) : null}::jsonb, ${req.jwt.email}
      )
      RETURNING *
    `
    res.status(201).json({ template: rows[0], analyzed: !!analysis })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/contracts/templates ─────────────────────────────
router.get('/templates', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await req.tenantDb.$queryRaw<any[]>`
      SELECT * FROM contract_templates WHERE tenant_id = ${req.tenant.id} ORDER BY created_at DESC
    `
    res.json({ templates: rows })
  } catch (err) {
    next(err)
  }
})

// ── PATCH /api/contracts/templates/:id ───────────────────────
const tplPatchSchema = z.object({
  nombre:          z.string().min(1).optional(),
  tipo:            z.string().optional(),
  puestoAplica:    z.array(z.string()).optional(),
  clausulas:       z.array(z.string()).optional(),
  camposVariables: z.array(z.string()).optional(),
  disposiciones:   z.string().optional(),
})

router.patch('/templates/:id', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = tplPatchSchema.parse(req.body)
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb

    const rows = await tenantDb.$queryRaw<any[]>`
      UPDATE contract_templates SET
        nombre           = COALESCE(${input.nombre ?? null}, nombre),
        tipo             = COALESCE(${input.tipo ?? null}, tipo),
        puesto_aplica    = COALESCE(${input.puestoAplica ? JSON.stringify(input.puestoAplica) : null}::jsonb, puesto_aplica),
        clausulas        = COALESCE(${input.clausulas ? JSON.stringify(input.clausulas) : null}::jsonb, clausulas),
        campos_variables = COALESCE(${input.camposVariables ? JSON.stringify(input.camposVariables) : null}::jsonb, campos_variables),
        disposiciones    = COALESCE(${input.disposiciones ?? null}, disposiciones)
      WHERE id = ${req.params.id} AND tenant_id = ${tenantId}
      RETURNING *
    `
    if (!rows[0]) throw new AppError(404, 'Machote no encontrado')
    res.json({ template: rows[0] })
  } catch (err) {
    next(err)
  }
})

// ── DELETE /api/contracts/templates/:id ──────────────────────
router.delete('/templates/:id', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await req.tenantDb.$queryRaw<any[]>`
      DELETE FROM contract_templates WHERE id = ${req.params.id} AND tenant_id = ${req.tenant.id} RETURNING id
    `
    if (!rows[0]) throw new AppError(404, 'Machote no encontrado')
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/contracts/templates/:id/generate ───────────────
// Genera un contrato concreto a partir del machote + datos del colaborador
// + campos personalizados. Rellena {VARIABLES} y produce un PDF firmable.
const generateSchema = z.object({
  employeeId:   z.string().min(1),
  customFields: z.record(z.string(), z.string()).optional().default({}),
})

router.post('/templates/:id/generate', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { employeeId, customFields } = generateSchema.parse(req.body)
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb

    const tplRows = await tenantDb.$queryRaw<any[]>`
      SELECT * FROM contract_templates WHERE id = ${req.params.id} AND tenant_id = ${tenantId} LIMIT 1
    `
    const tpl = tplRows[0]
    if (!tpl) throw new AppError(404, 'Machote no encontrado')

    const empRows = await tenantDb.$queryRaw<any[]>`
      SELECT * FROM employees WHERE id = ${employeeId} AND tenant_id = ${tenantId} LIMIT 1
    `
    const emp = empRows[0]
    if (!emp) throw new AppError(404, 'Colaborador no encontrado')

    const salario = Number(emp.monthly_salary ?? 0)
    // Mapa de variables conocidas → datos reales del colaborador.
    const varMap: Record<string, string> = {
      NOMBRE:       emp.full_name || [emp.first_name, emp.last_name].filter(Boolean).join(' '),
      PUESTO:       emp.position || '',
      DEPARTAMENTO: emp.department || '',
      PLANTA:       emp.plant || '',
      TURNO:        emp.shift || '',
      SALARIO:      mxn(salario),
      SALARIO_DIARIO: mxn2(salario / 30),
      RFC:          emp.rfc || '',
      CURP:         emp.curp || '',
      NSS:          emp.nss || '',
      FECHA:        fmtDate(new Date().toISOString()),
      EMPRESA:      req.tenant.name,
      ...customFields, // los custom sobreescriben
    }

    // Rellena {VAR} en cláusulas y disposiciones.
    const fill = (s: string) => s.replace(/\{([A-Z0-9_]+)\}/g, (m, k) => varMap[k] ?? m)
    const clausulas: string[] = Array.isArray(tpl.clausulas) ? tpl.clausulas : []
    const disposiciones = tpl.disposiciones ? fill(tpl.disposiciones) : ''

    const html = buildTemplateContractHtml(req.tenant.name, tpl.nombre, varMap.NOMBRE, clausulas.map(fill), disposiciones)
    const pdfBuffer = await htmlToPdf(html)

    const insertRows = await tenantDb.$queryRaw<any[]>`
      INSERT INTO contracts (tenant_id, employee_id, contract_type, start_date, monthly_salary, position, plant, template_used, html_content, generated_by, status)
      VALUES (${tenantId}, ${employeeId}, ${tpl.tipo || 'Indeterminado'}, NOW(), ${salario || null}, ${emp.position || null}, ${emp.plant || null}, ${tpl.id}, ${html}, ${req.jwt.email}, 'Borrador')
      RETURNING id
    `
    const contractId = insertRows[0].id
    const pdfUrl = await savePdf(`contracts/${tenantId}/${contractId}.pdf`, pdfBuffer)
    await tenantDb.$executeRaw`UPDATE contracts SET pdf_url = ${pdfUrl} WHERE id = ${contractId}`

    res.status(201).json({ pdfUrl, contractId })
  } catch (err) {
    next(err)
  }
})

function buildTemplateContractHtml(tenantName: string, tplNombre: string, nombreTrabajador: string, clausulas: string[], disposiciones: string): string {
  const clausulasHtml = clausulas.length
    ? clausulas.map((c, i) => `<h2>${romano(i + 1)} — Cláusula</h2><p>${c}</p>`).join('')
    : '<p class="meta">Sin cláusulas registradas en el machote.</p>'
  const dispHtml = disposiciones
    ? `<h2>Disposiciones especiales</h2><p>${disposiciones.replace(/\n/g, '<br>')}</p>`
    : ''
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:Georgia,serif;color:#16202e;max-width:720px;margin:0 auto;padding:36px;line-height:1.65;font-size:13.5px}
h1{font-size:17px;text-align:center;text-transform:uppercase}
h2{font-size:13px;margin-top:22px;border-bottom:1px solid #ccc;padding-bottom:5px}
.meta{font-size:12px;color:#555}
.sign{margin-top:54px;display:flex;justify-content:space-between;gap:40px}
.sign div{flex:1;text-align:center;border-top:1px solid #16202e;padding-top:8px;font-size:11px}
</style></head><body>
<h1>${tplNombre || 'Contrato Individual de Trabajo'}</h1>
<p class="meta">Que celebran por una parte <b>${tenantName}</b> (el "Patrón"), y por la otra <b>${nombreTrabajador || '[Nombre del trabajador]'}</b> (el "Trabajador"), al amparo de la Ley Federal del Trabajo (LFT).</p>
${clausulasHtml}
${dispHtml}
<div class="sign"><div>El Patrón<br>${tenantName}</div><div>El Trabajador<br>${nombreTrabajador}</div></div>
<p style="margin-top:30px;font-size:10px;color:#888">Generado por KODICE desde machote «${tplNombre}» · Plantilla referencial. Validar con asesoría jurídica antes de su uso.</p>
</body></html>`
}

const ROMANOS = ['', 'Primera', 'Segunda', 'Tercera', 'Cuarta', 'Quinta', 'Sexta', 'Séptima', 'Octava', 'Novena', 'Décima']
function romano(n: number): string { return ROMANOS[n] || `Cláusula ${n}` }

export default router

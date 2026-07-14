// ============================================================
// CÓDICE · Contracts routes
// POST /:id/pdf — renderiza el contrato (HTML guardado o plantilla
// LFT de respaldo) a PDF con Puppeteer y lo guarda en R2/tmp.
// ============================================================

import { Router, Request, Response, NextFunction } from 'express'
import { requireHR } from '../middleware/auth'
import { AppError }  from '../lib/errors'
import { htmlToPdf } from '../lib/pdf'
import { savePdf }   from '../lib/storage'

const router = Router()

router.get('/', (req, res) => res.json({ route: 'contracts', status: 'ok' }))

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

export default router

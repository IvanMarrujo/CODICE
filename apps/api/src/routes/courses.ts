// ============================================================
// CÓDICE · Courses routes
// POST /:courseId/constancia/:employeeId — genera la constancia
// de un curso completado (PDF con Puppeteer) y actualiza el
// progreso del empleado.
// ============================================================

import { Router, Request, Response, NextFunction } from 'express'
import { z }         from 'zod'
import { requireHR } from '../middleware/auth'
import { AppError }  from '../lib/errors'
import { htmlToPdf } from '../lib/pdf'
import { savePdf }   from '../lib/storage'

const router = Router()

const listQuerySchema = z.object({
  employeeId: z.string().min(1).optional(),
})

// ── GET / ─────────────────────────────────────────────────────
// Lista los cursos activos. Si se pasa employeeId, adjunta el
// progreso de ese empleado en cada curso (o null si no lo ha iniciado).

router.get('/', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { employeeId } = listQuerySchema.parse(req.query)
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb

    const courses = await tenantDb.$queryRaw<any[]>`
      SELECT id, title, category, description, duration_min, is_mandatory, expires_months,
             quiz_questions, pass_score, xp_reward, thumbnail_url, content_url
      FROM courses
      WHERE tenant_id = ${tenantId} AND is_active = true
      ORDER BY is_mandatory DESC, title ASC
    `

    if (!employeeId) return res.json({ data: courses })

    const progress = await tenantDb.$queryRaw<any[]>`
      SELECT course_id, progress_pct, score, attempts, passed, xp_earned, completed_at, expires_at, constancia_url
      FROM course_progress
      WHERE tenant_id = ${tenantId} AND employee_id = ${employeeId}
    `
    const progressByCourse = new Map(progress.map((p: any) => [p.course_id, p]))
    const data = courses.map((c: any) => ({ ...c, progress: progressByCourse.get(c.id) ?? null }))

    res.json({ data })
  } catch (err) {
    next(err)
  }
})

const constanciaSchema = z.object({
  score: z.coerce.number().min(0).max(100).optional(),
})

const fmtDate = (d: Date) => d.toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })

function buildConstanciaHtml(opts: {
  tenantName: string
  employeeName: string
  courseTitle: string
  category: string | null
  score: number
  completedAt: Date
}): string {
  const { tenantName, employeeName, courseTitle, category, score, completedAt } = opts
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:'Georgia',serif;color:#16202e;margin:0;padding:0}
.card{width:900px;height:640px;margin:0 auto;padding:60px;box-sizing:border-box;border:10px solid #16202e;position:relative;text-align:center;background:radial-gradient(120% 120% at 50% 0%,#f4f8fb 0%,#ffffff 60%)}
.logo{width:64px;height:64px;border-radius:16px;margin:0 auto 18px;background:linear-gradient(135deg,#56d4f0,#a78bfa)}
.eyebrow{font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.3em;text-transform:uppercase;color:#5d6878}
h1{font-size:30px;margin:14px 0 6px;text-transform:uppercase;letter-spacing:.03em}
.sub{font-size:13px;color:#5d6878;margin-bottom:36px}
.name{font-size:26px;font-weight:700;margin:18px 0;border-bottom:2px solid #16202e;display:inline-block;padding:0 20px 8px}
.course{font-size:16px;margin:10px 0 26px}
.meta{display:flex;justify-content:center;gap:50px;margin-top:30px;font-size:12px;color:#333}
.meta b{display:block;font-size:18px;margin-bottom:3px}
.foot{position:absolute;bottom:28px;left:0;right:0;font-size:10px;color:#8794a6}
</style></head><body>
<div class="card">
  <div class="logo"></div>
  <div class="eyebrow">${tenantName} · CÓDICE Capacitación</div>
  <h1>Constancia de participación</h1>
  <div class="sub">Se otorga la presente constancia a</div>
  <div class="name">${employeeName}</div>
  <div class="course">por haber completado satisfactoriamente el curso<br><b>"${courseTitle}"</b>${category ? ` · ${category}` : ''}</div>
  <div class="meta">
    <div><b>${score}%</b>Calificación</div>
    <div><b>${fmtDate(completedAt)}</b>Fecha de emisión</div>
  </div>
  <div class="foot">Generado por CÓDICE · Documento de capacitación interna, no constituye certificación oficial.</div>
</div>
</body></html>`
}

router.post('/:courseId/constancia/:employeeId', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { score: scoreInput } = constanciaSchema.parse(req.body || {})
    const { courseId, employeeId } = req.params
    const tenantId = req.tenant.id
    const tenantDb = req.tenantDb

    const courseRows = await tenantDb.$queryRaw<any[]>`
      SELECT * FROM courses WHERE id = ${courseId} AND tenant_id = ${tenantId} LIMIT 1
    `
    const course = courseRows[0]
    if (!course) throw new AppError(404, 'Curso no encontrado')

    const empRows = await tenantDb.$queryRaw<any[]>`
      SELECT id, full_name FROM employees WHERE id = ${employeeId} AND tenant_id = ${tenantId} LIMIT 1
    `
    const employee = empRows[0]
    if (!employee) throw new AppError(404, 'Empleado no encontrado')

    const passScore = course.pass_score ?? 70
    const score = scoreInput ?? passScore
    if (score < passScore) {
      throw new AppError(400, `La calificación (${score}) no alcanza el mínimo (${passScore}) para emitir constancia`)
    }

    const completedAt = new Date()
    const expiresAt = course.expires_months
      ? new Date(completedAt.getFullYear(), completedAt.getMonth() + course.expires_months, completedAt.getDate())
      : null

    const html = buildConstanciaHtml({
      tenantName:   req.tenant.name,
      employeeName: employee.full_name,
      courseTitle:  course.title,
      category:     course.category,
      score,
      completedAt,
    })
    const pdfBuffer = await htmlToPdf(html)
    const constanciaUrl = await savePdf(`constancias/${tenantId}/${courseId}_${employeeId}.pdf`, pdfBuffer)

    await tenantDb.$executeRaw`
      INSERT INTO course_progress
        (tenant_id, employee_id, course_id, progress_pct, score, attempts, passed, xp_earned, started_at, completed_at, expires_at, constancia_url)
      VALUES
        (${tenantId}, ${employeeId}, ${courseId}, 100, ${score}, 1, true, ${course.xp_reward ?? 0}, ${completedAt}, ${completedAt}, ${expiresAt}, ${constanciaUrl})
      ON CONFLICT (employee_id, course_id) DO UPDATE SET
        progress_pct   = 100,
        score          = EXCLUDED.score,
        attempts       = course_progress.attempts + 1,
        passed         = true,
        xp_earned      = EXCLUDED.xp_earned,
        completed_at   = EXCLUDED.completed_at,
        expires_at     = EXCLUDED.expires_at,
        constancia_url = EXCLUDED.constancia_url
    `

    res.json({ constanciaUrl })
  } catch (err) {
    next(err)
  }
})

export default router

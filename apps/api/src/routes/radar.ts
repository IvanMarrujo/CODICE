// ============================================================
// CÓDICE Radar · Endpoints
// GET  /api/radar/latest   (requireHR) — último digest (Redis)
// POST /api/radar/refresh  (requireHR) — dispara una corrida ahora
// GET  /api/radar/history  (requireHR) — últimos 4 digests (DB)
// ============================================================

import { Router, Request, Response, NextFunction } from 'express'
import { redis } from '../lib/redis'
import { requireHR } from '../middleware/auth'
import { runRadarForTenant } from '../jobs/radarWeekly'

const router = Router()

function radarCacheKey(tenantId: string) { return `t:${tenantId}:radar:latest` }

// ── GET /api/radar/latest ─────────────────────────────────────

router.get('/latest', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cached = await redis.get(radarCacheKey(req.tenant.id))
    if (cached) return res.json(JSON.parse(cached))
    res.json({ generatedAt: null, items: [], summary: { alta: 0, media: 0, baja: 0 }, sourcesSearched: [] })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/radar/refresh ────────────────────────────────────
// Bajo demanda (botón "Actualizar ahora") — llama a Claude + web_search
// en vivo, así que puede tardar varios segundos.

router.post('/refresh', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant.id
    const digest = await runRadarForTenant(tenantId, req.tenantDb, { name: req.tenant.name, industry: req.tenant.industry })
    res.json(digest)
  } catch (err) {
    next(err)
  }
})

// ── GET /api/radar/history ─────────────────────────────────────

router.get('/history', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await req.tenantDb.$queryRaw<any[]>`
      SELECT id, generated_at, items, alta_count, media_count, baja_count, sources_searched
      FROM radar_digests
      WHERE tenant_id = ${req.tenant.id}
      ORDER BY generated_at DESC
      LIMIT 4
    `
    res.json({ digests: rows })
  } catch (err) {
    next(err)
  }
})

export default router

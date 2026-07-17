// ============================================================
// CÓDICE · GET /api/news (requireEmployee) — tablero de avisos.
// Hoy solo devuelve lo que CÓDICE Radar publicó (ver lib/news.ts) —
// el shell colaborador lo combina con sus avisos estáticos.
// ============================================================

import { Router, Request, Response, NextFunction } from 'express'
import { requireEmployee } from '../middleware/auth'
import { getNews } from '../lib/news'

const router = Router()

router.get('/', requireEmployee, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await getNews(req.tenant.id)
    res.json({ items })
  } catch (err) {
    next(err)
  }
})

export default router

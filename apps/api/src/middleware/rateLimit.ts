import { Request, Response, NextFunction } from 'express'
import { redis } from '../lib/redis'
export async function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const tid = (req as any).jwt?.tid
    const key = tid ? `t:${tid}:rl:${req.ip}` : `global:rl:${req.ip}`
    const count = await redis.incr(key)
    if (count === 1) await redis.expire(key, 60)
    if (count > 200) return res.status(429).json({ error: 'Demasiadas solicitudes' })
    next()
  } catch { next() }
}

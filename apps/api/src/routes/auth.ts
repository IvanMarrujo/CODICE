// ============================================================
// CÓDICE · Auth routes
// Login / refresh de AdminUsers (panel de RH). Montadas en
// index.ts ANTES del pipeline authMiddleware/tenantMiddleware
// (son las rutas que emiten el JWT, no lo requieren).
// ============================================================

import { Router, Request, Response, NextFunction } from 'express'
import jwt                                          from 'jsonwebtoken'
import bcrypt                                        from 'bcryptjs'
import * as crypto                                    from 'crypto'
import { z }                                           from 'zod'
import { prismaPublic }                                from '../lib/prisma'
import { redis }                                       from '../lib/redis'
import { AppError }                                    from '../lib/errors'
import type { JWTPayload }                             from '../middleware/auth'

const router = Router()

router.get('/', (req, res) => res.json({ route: 'auth', status: 'stub — implementar' }))

// ── Validación ────────────────────────────────────────────────

const loginSchema = z.object({
  slug:     z.string().min(1),
  email:    z.string().email(),
  password: z.string().min(1),
})

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
})

// ── Helpers de tokens ────────────────────────────────────────

function signAccessToken(payload: Pick<JWTPayload, 'sub' | 'tid' | 'role' | 'email'>): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, {
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  } as jwt.SignOptions)
}

function signRefreshToken(sub: string, tid: string, jti: string): string {
  return jwt.sign({ sub, tid, jti }, process.env.JWT_REFRESH_SECRET!, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  } as jwt.SignOptions)
}

// Guarda el jti en Redis (TTL = expiración real del token) para poder
// revocar/rotar refresh tokens sin depender solo de la firma JWT.
// También indexamos por t:{tenantId}:session:{userId} -> jti para poder
// cerrar sesión sin que el cliente tenga que reenviar el refresh token.
async function storeRefreshToken(token: string, jti: string, userId: string, tenantId: string) {
  const decoded = jwt.decode(token) as { exp?: number } | null
  const ttlSeconds = decoded?.exp ? decoded.exp - Math.floor(Date.now() / 1000) : 7 * 24 * 3600
  const ttl = Math.max(ttlSeconds, 1)
  await redis.set(`refresh:${jti}`, userId, 'EX', ttl)
  await redis.set(`t:${tenantId}:session:${userId}`, jti, 'EX', ttl)
}

async function issueTokenPair(user: { id: string; role: string; email: string }, tenantId: string) {
  const accessToken = signAccessToken({ sub: user.id, tid: tenantId, role: user.role as any, email: user.email })
  const jti          = crypto.randomUUID()
  const refreshToken = signRefreshToken(user.id, tenantId, jti)
  await storeRefreshToken(refreshToken, jti, user.id, tenantId)
  return { accessToken, refreshToken }
}

function publicUser(user: { id: string; email: string; firstName: string; lastName: string; role: string }) {
  return { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role }
}

function publicTenant(tenant: { id: string; slug: string; name: string; plan: string; status: string }) {
  return { id: tenant.id, slug: tenant.slug, name: tenant.name, plan: tenant.plan, status: tenant.status }
}

// Ventana anti fuerza bruta: 10 intentos / 15 min por IP+slug+email.
// No distingue "usuario no existe" de "password incorrecto" en la respuesta
// para evitar enumeración de cuentas.
async function checkLoginRateLimit(key: string) {
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, 15 * 60)
  if (count > 10) throw new AppError(429, 'Demasiados intentos de inicio de sesión. Intenta de nuevo en unos minutos.')
}

// ── POST /api/auth/login ─────────────────────────────────────

router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slug, email, password } = loginSchema.parse(req.body)
    const normalizedEmail = email.trim().toLowerCase()

    const rlKey = `login:rl:${req.ip}:${slug}:${normalizedEmail}`
    await checkLoginRateLimit(rlKey)

    const tenant = await prismaPublic.tenant.findUnique({ where: { slug } })
    if (!tenant || tenant.status !== 'ACTIVE') {
      throw new AppError(401, 'Credenciales inválidas')
    }

    const user = await prismaPublic.adminUser.findFirst({
      where: { tenantId: tenant.id, email: { equals: normalizedEmail, mode: 'insensitive' } },
    })
    if (!user || !user.isActive) {
      throw new AppError(401, 'Credenciales inválidas')
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash)
    if (!validPassword) throw new AppError(401, 'Credenciales inválidas')

    await redis.del(rlKey)

    const { accessToken, refreshToken } = await issueTokenPair(user, tenant.id)
    await prismaPublic.adminUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })

    res.json({
      accessToken,
      refreshToken,
      user:   publicUser(user),
      tenant: publicTenant(tenant),
    })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/auth/refresh ───────────────────────────────────

router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = refreshSchema.parse(req.body)

    let payload: { sub: string; tid: string; jti: string }
    try {
      payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!) as typeof payload
    } catch {
      throw new AppError(401, 'Refresh token inválido o expirado')
    }

    const storedUserId = await redis.get(`refresh:${payload.jti}`)
    if (!storedUserId || storedUserId !== payload.sub) {
      throw new AppError(401, 'Refresh token inválido o revocado')
    }

    const [tenant, user] = await Promise.all([
      prismaPublic.tenant.findUnique({ where: { id: payload.tid } }),
      prismaPublic.adminUser.findUnique({ where: { id: payload.sub } }),
    ])

    if (!tenant || tenant.status !== 'ACTIVE')                    throw new AppError(401, 'Tenant no disponible')
    if (!user || !user.isActive || user.tenantId !== tenant.id)   throw new AppError(401, 'Usuario no disponible')

    // Rotación: el refresh token usado se invalida y se emite uno nuevo
    await redis.del(`refresh:${payload.jti}`)
    const { accessToken, refreshToken: newRefreshToken } = await issueTokenPair(user, tenant.id)

    res.json({
      accessToken,
      refreshToken: newRefreshToken,
      user:   publicUser(user),
      tenant: publicTenant(tenant),
    })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/auth/logout ────────────────────────────────────
// Revoca el refresh token (jti) y borra la sesión indexada por usuario,
// para que /refresh ya no pueda usarse una vez cerrada la sesión.

router.post('/logout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = refreshSchema.parse(req.body)

    let payload: { sub: string; tid: string; jti: string }
    try {
      payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!) as typeof payload
    } catch {
      // Token ya inválido/expirado: no hay nada que revocar, logout es idempotente.
      return res.json({ ok: true })
    }

    await redis.del(`refresh:${payload.jti}`)
    await redis.del(`t:${payload.tid}:session:${payload.sub}`)

    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router

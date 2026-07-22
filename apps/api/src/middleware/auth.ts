// ============================================================
// CÓDICE · Auth middleware
// Verifica JWT, extrae claims (tid, role, sub), adjunta al req.
// ============================================================

import { Request, Response, NextFunction } from 'express'
import jwt                                 from 'jsonwebtoken'
import { AppError }                        from '../lib/errors'
import type { AdminRole }                  from '@prisma/client'

export interface JWTPayload {
  sub:   string       // userId (AdminUser.id o employee.id)
  tid:   string       // tenantId
  role:  AdminRole | 'EMPLOYEE'
  email: string
  iat:   number
  exp:   number
}

// Extiende el tipo Request de Express
declare global {
  namespace Express {
    interface Request {
      jwt:      JWTPayload
      tenant:   any        // Tenant record (seteado por tenantMiddleware)
      tenantDb: any        // PrismaClient del schema del tenant
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization
    if (!header || !header.startsWith('Bearer ')) {
      throw new AppError(401, 'Token de autorización requerido')
    }

    const token = header.slice(7)
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as JWTPayload
    req.jwt = payload
    next()
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      return next(new AppError(401, 'Sesión expirada. Inicia sesión nuevamente.'))
    }
    if (err.name === 'JsonWebTokenError') {
      return next(new AppError(401, 'Token inválido'))
    }
    next(err)
  }
}

// ── RBAC guard factory ───────────────────────────────────────
// Uso en routes: router.get('/', requireRole('HR_MANAGER', 'SUPER_ADMIN'), handler)

type Role = AdminRole | 'EMPLOYEE'

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!roles.includes(req.jwt.role)) {
      return next(new AppError(403, 'No tienes permisos para esta acción'))
    }
    next()
  }
}

// Shorthand guards
export const requireAdmin     = requireRole('SUPER_ADMIN')
export const requireHR        = requireRole('SUPER_ADMIN', 'HR_MANAGER', 'HR_ANALYST')
export const requireManager   = requireRole('SUPER_ADMIN', 'HR_MANAGER', 'HR_ANALYST', 'AREA_MANAGER')
export const requireEmployee  = requireRole('SUPER_ADMIN', 'HR_MANAGER', 'HR_ANALYST', 'AREA_MANAGER', 'EMPLOYEE')
// Supervisor Shell (apps/web/src/components/SupervisorShell.jsx) — solo el
// propio supervisor o un SUPER_ADMIN de soporte, nunca HR_MANAGER/ANALYST a
// secas (esas rutas devuelven datos ya recortados por equipo, no por rol).
export const requireAreaManager = requireRole('SUPER_ADMIN', 'AREA_MANAGER')

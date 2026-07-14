// ============================================================
// CÓDICE · Tenant middleware
// Extrae tenant_id del JWT, verifica que el tenant esté ACTIVE,
// y crea un Prisma client apuntando al schema del tenant.
// ============================================================

import { Request, Response, NextFunction } from 'express'
import { PrismaClient }                    from '@prisma/client'
import { prismaPublic }                    from '../lib/prisma'
import { AppError }                        from '../lib/errors'

// Cache de clientes Prisma por schema (evita crear uno por request)
const clientCache = new Map<string, PrismaClient>()

export async function getTenantPrisma(dbSchema: string): Promise<PrismaClient> {
  if (clientCache.has(dbSchema)) return clientCache.get(dbSchema)!

  // `SET search_path` es a nivel de conexión física, no de pool. Con el pool
  // por default de Prisma (varias conexiones), una query puede caer en una
  // conexión donde nunca se corrió el SET y fallar con "relation does not
  // exist". connection_limit=1 fuerza una sola conexión física para este
  // client, así el search_path seteado abajo aplica a TODAS sus queries.
  const url = new URL(process.env.DATABASE_URL!)
  url.searchParams.set('connection_limit', '1')

  const client = new PrismaClient({
    datasources: { db: { url: url.toString() } },
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })

  // Setear search_path al schema del tenant en cada conexión
  // Esto hace que Prisma opere SOLO sobre las tablas de este tenant
  await client.$executeRawUnsafe(`SET search_path = "${dbSchema}", public`)

  clientCache.set(dbSchema, client)
  return client
}

export async function tenantMiddleware(
  req:  Request,
  res:  Response,
  next: NextFunction
) {
  try {
    const tenantId = req.jwt?.tid   // claim del JWT seteado por authMiddleware
    if (!tenantId) throw new AppError(401, 'Token sin tenant_id')

    // Buscar tenant en schema público
    const tenant = await prismaPublic.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id:          true,
        slug:        true,
        name:        true,
        dbSchema:    true,
        redisNs:     true,
        plan:        true,
        status:      true,
        maxEmployees: true,
        maxAdminUsers: true,
      }
    })

    if (!tenant)             throw new AppError(404, 'Tenant no encontrado')
    if (tenant.status === 'SUSPENDED')  throw new AppError(403, 'Cuenta suspendida. Contactar soporte.')
    if (tenant.status === 'CANCELLED')  throw new AppError(403, 'Cuenta cancelada.')
    if (tenant.status === 'PROVISIONING') throw new AppError(503, 'Tenant en proceso de configuración.')

    // Obtener (o crear) el Prisma client del schema de este tenant
    const tenantDb = await getTenantPrisma(tenant.dbSchema)

    // Re-afirmar el search_path en cada request: el pool de Prisma puede
    // reciclar la conexión física de forma transparente (idle timeout, error
    // de red, etc.), y esa nueva conexión no hereda el SET original hecho al
    // crear el client — causando "relation does not exist" de forma
    // intermitente. Es una query trivial, no un problema de performance real.
    await tenantDb.$executeRawUnsafe(`SET search_path = "${tenant.dbSchema}", public`)

    // Adjuntar al request para uso en route handlers
    req.tenant   = tenant
    req.tenantDb = tenantDb

    next()
  } catch (err) {
    next(err)
  }
}

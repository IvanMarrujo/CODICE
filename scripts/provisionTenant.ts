#!/usr/bin/env ts-node
// ============================================================
// CÓDICE · provisionTenant.ts
// Crea un tenant nuevo completamente aislado:
//   1. Registro en schema public (Prisma)
//   2. PostgreSQL schema con todas las tablas del tenant
//   3. Namespace Redis
//   4. (Opcional) bucket R2
//   5. Usuario admin inicial
//
// Uso:
//   npx ts-node scripts/provisionTenant.ts \
//     --slug gfp \
//     --name "Grupo Food Packing Co." \
//     --email admin@gfp.mx \
//     --plan CORE \
//     --industry MANUFACTURA_ALIMENTOS
// ============================================================

import { PrismaClient, Plan, Industry } from '@prisma/client'
import { createClient }                  from 'redis'
import { Client as PgClient }            from 'pg'
import * as fs                           from 'fs'
import * as path                         from 'path'
import * as crypto                       from 'crypto'

// Minimal arg parser (no dep on commander for this script)
const args = process.argv.slice(2).reduce((acc, val, i, arr) => {
  if (val.startsWith('--')) acc[val.slice(2)] = arr[i + 1]
  return acc
}, {} as Record<string, string>)

const SLUG     = args.slug     || 'demo'
const NAME     = args.name     || 'Demo Tenant'
const EMAIL    = args.email    || `admin@${args.slug || 'demo'}.codice.mx`
const PLAN     = (args.plan    || 'CORE')     as Plan
const INDUSTRY = (args.industry || 'MANUFACTURA_ALIMENTOS') as Industry

// ── helpers ──────────────────────────────────────────────────

function cuid() {
  return 'c' + crypto.randomBytes(8).toString('hex')
}

function log(emoji: string, msg: string) {
  console.log(`${emoji}  ${msg}`)
}

function readTenantSQL(schema: string): string {
  const tpl = fs.readFileSync(
    path.join(__dirname, '../packages/database/prisma/tenant-schema.sql'),
    'utf8'
  )
  return tpl.split('{SCHEMA}').join(schema)
}

// ── main ─────────────────────────────────────────────────────

async function main() {
  console.log('\n🚀 CÓDICE · Provisioning tenant\n')
  log('📋', `Slug:     ${SLUG}`)
  log('🏢', `Name:     ${NAME}`)
  log('📧', `Email:    ${EMAIL}`)
  log('💳', `Plan:     ${PLAN}`)
  log('🏭', `Industry: ${INDUSTRY}`)
  console.log()

  const prisma = new PrismaClient({
    log: ['error']
  })

  // ── 1. Verificar que el slug no exista ───────────────────
  const existing = await prisma.tenant.findUnique({ where: { slug: SLUG } })
  if (existing) {
    console.error(`❌  Tenant con slug "${SLUG}" ya existe (id: ${existing.id})`)
    process.exit(1)
  }

  // ── 2. Generar IDs únicos ────────────────────────────────
  const tenantId  = cuid()
  const dbSchema  = `tenant_${tenantId}`
  const redisNs   = `t:${tenantId}`
  const r2Bucket  = `codice-${tenantId}`

  // ── 3. Crear registro en schema público ─────────────────
  log('⚙️ ', 'Creando registro en schema público...')
  const tenant = await prisma.tenant.create({
    data: {
      id:           tenantId,
      slug:         SLUG,
      name:         NAME,
      plan:         PLAN,
      industry:     INDUSTRY,
      contactEmail: EMAIL,
      dbSchema:     dbSchema,
      redisNs:      redisNs,
      r2Bucket:     r2Bucket,
      status:       'PROVISIONING',
      maxEmployees: PLAN === 'CONECTOR' ? 100 : PLAN === 'CORE' ? 300 : 999,
      maxAdminUsers: PLAN === 'ENTERPRISE' ? 20 : 5,
    }
  })
  log('✅', `Tenant creado: ${tenant.id}`)

  // ── 4. Crear PostgreSQL schema ────────────────────────────
  log('🗄️ ', `Creando schema PostgreSQL: ${dbSchema}...`)
  const sql = readTenantSQL(dbSchema)

  // Ejecutamos el SQL completo en una sola llamada vía `pg`: el parseo de
  // statements (incluyendo bloques $$...$$ de funciones/DO) lo hace el
  // propio Postgres, no un split(';') ingenuo en JS que rompe esos bloques
  // y descarta statements pegados a comentarios sin ';' de por medio.
  const pg = new PgClient({ connectionString: process.env.DATABASE_URL })
  await pg.connect()
  try {
    await pg.query(`CREATE SCHEMA IF NOT EXISTS "${dbSchema}"`)
    await pg.query(sql)
  } finally {
    await pg.end()
  }

  const tableCount = (sql.match(/CREATE TABLE/gi) || []).length
  log('✅', `Schema creado con ${tableCount} tablas`)

  // ── 5. Dar permisos al rol de app ────────────────────────
  try {
    await prisma.$executeRawUnsafe(
      `GRANT USAGE ON SCHEMA "${dbSchema}" TO codice_app`
    )
    await prisma.$executeRawUnsafe(
      `GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA "${dbSchema}" TO codice_app`
    )
    await prisma.$executeRawUnsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA "${dbSchema}" GRANT ALL ON TABLES TO codice_app`
    )
    log('✅', 'Permisos de app role asignados')
  } catch {
    log('⚠️ ', 'No se pudieron asignar permisos de codice_app (puede no existir en local)')
  }

  // ── 6. Inicializar Redis namespace ────────────────────────
  log('⚡', `Inicializando Redis namespace: ${redisNs}...`)
  try {
    const redis = createClient({
      url: process.env.REDIS_URL || 'redis://:codice_redis_2024@localhost:6379'
    })
    await redis.connect()
    await redis.set(`${redisNs}:status`, 'provisioning')
    await redis.set(`${redisNs}:plan`,   PLAN)
    await redis.set(`${redisNs}:name`,   NAME)
    await redis.disconnect()
    log('✅', 'Redis namespace inicializado')
  } catch (err: any) {
    log('⚠️ ', `Redis no disponible: ${err.message?.slice(0, 60)} (continuar sin Redis)`)
  }

  // ── 7. Crear admin user inicial ───────────────────────────
  log('👤', `Creando usuario admin: ${EMAIL}...`)
  const tempPassword = crypto.randomBytes(8).toString('hex')
  const bcrypt       = await import('bcryptjs')
  const hash         = await bcrypt.hash(tempPassword, 12)

  await prisma.adminUser.create({
    data: {
      tenantId:     tenant.id,
      email:        EMAIL,
      passwordHash: hash,
      firstName:    'Admin',
      lastName:     NAME,
      role:         'HR_MANAGER',
    }
  })
  log('✅', 'Usuario admin creado')

  // ── 8. Marcar como ACTIVE ─────────────────────────────────
  await prisma.tenant.update({
    where: { id: tenant.id },
    data:  { status: 'ACTIVE', activatedAt: new Date() }
  })

  // ── 9. Audit log ──────────────────────────────────────────
  await prisma.globalAuditLog.create({
    data: {
      tenantId: tenant.id,
      actor:    'system:provision',
      action:   'tenant.created',
      resource: `tenant:${tenant.id}`,
      payload:  { slug: SLUG, plan: PLAN, industry: INDUSTRY }
    }
  })

  await prisma.$disconnect()

  // ── Resumen ───────────────────────────────────────────────
  console.log('\n' + '═'.repeat(55))
  console.log('✅  TENANT PROVISIONADO EXITOSAMENTE')
  console.log('═'.repeat(55))
  console.log(`  Tenant ID:    ${tenant.id}`)
  console.log(`  DB Schema:    ${dbSchema}`)
  console.log(`  Redis NS:     ${redisNs}`)
  console.log(`  R2 Bucket:    ${r2Bucket}`)
  console.log(`  Admin email:  ${EMAIL}`)
  console.log(`  Temp pass:    ${tempPassword}  ← cambiar en el primer login`)
  console.log('═'.repeat(55) + '\n')
}

main().catch(err => {
  console.error('\n❌  Error en provisioning:', err.message)
  process.exit(1)
})

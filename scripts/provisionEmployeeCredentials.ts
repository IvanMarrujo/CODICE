#!/usr/bin/env ts-node
// ============================================================
// CÓDICE · provisionEmployeeCredentials.ts
// Genera password_hash inicial para los empleados de un tenant que
// todavía no tienen credencial (password_hash IS NULL): password inicial
// = CURP (o NSS si no hay CURP), hasheado con bcrypt, con
// must_change_password = true para forzar cambio en el primer login
// (la pantalla que consuma ese flag es un paso futuro — ver
// POST /api/auth/employee-login en routes/auth.ts).
//
// Requiere que migrateEmployeeAuth.ts ya haya corrido en el tenant
// (columnas password_hash / must_change_password existentes).
//
// Uso:
//   npx ts-node scripts/provisionEmployeeCredentials.ts --slug=vitalhealth
//   npx ts-node scripts/provisionEmployeeCredentials.ts --slug=vitalhealth --dry-run
// ============================================================

import { PrismaClient } from '@prisma/client'
import { Client as PgClient } from 'pg'
import bcrypt from 'bcryptjs'

const BCRYPT_ROUNDS = 10

function parseArgs() {
  const args = process.argv.slice(2)
  const slugArg = args.find((a) => a.startsWith('--slug='))
  const slug = slugArg?.split('=')[1]
  const dryRun = args.includes('--dry-run')
  if (!slug) {
    console.error('❌  Falta --slug=<tenant-slug>')
    process.exit(1)
  }
  return { slug, dryRun }
}

async function main() {
  const { slug, dryRun } = parseArgs()
  console.log(`\n🚀 CÓDICE · Provisioning de credenciales — tenant "${slug}"${dryRun ? ' (dry-run, sin escribir)' : ''}\n`)

  const prisma = new PrismaClient({ log: ['error'] })
  const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true, slug: true, dbSchema: true } })
  if (!tenant) {
    console.log(`❌  No existe tenant "${slug}"`)
    await prisma.$disconnect()
    process.exit(1)
  }

  const pg = new PgClient({ connectionString: process.env.DATABASE_URL })
  await pg.connect()

  try {
    const schema = tenant.dbSchema

    const pending = await pg.query(
      `SELECT id, curp, nss FROM "${schema}".employees WHERE password_hash IS NULL`
    )

    const withCurp   = pending.rows.filter((r) => r.curp && r.curp.trim() !== '')
    const withNssOnly = pending.rows.filter((r) => (!r.curp || r.curp.trim() === '') && r.nss && r.nss.trim() !== '')
    const withNeither = pending.rows.filter((r) => (!r.curp || r.curp.trim() === '') && (!r.nss || r.nss.trim() === ''))

    console.log(`Empleados sin credencial: ${pending.rows.length}`)
    console.log(`  → password inicial = CURP: ${withCurp.length}`)
    console.log(`  → password inicial = NSS (sin CURP): ${withNssOnly.length}`)
    console.log(`  → SIN CURP ni NSS (no se puede provisionar): ${withNeither.length}`)
    if (withNeither.length > 0) {
      console.log('     ids:', withNeither.map((r) => r.id).join(', '))
    }

    if (dryRun) {
      console.log('\n(dry-run) No se escribió nada.\n')
      return
    }

    let updated = 0
    for (const row of [...withCurp, ...withNssOnly]) {
      const initialPassword = (row.curp && row.curp.trim() !== '') ? row.curp.trim() : row.nss.trim()
      const hash = await bcrypt.hash(initialPassword, BCRYPT_ROUNDS)
      await pg.query(
        `UPDATE "${schema}".employees SET password_hash = $1, must_change_password = true WHERE id = $2`,
        [hash, row.id]
      )
      updated++
    }

    console.log(`\n✅  ${updated} credencial(es) provisionada(s) en "${slug}" (${schema})`)
    if (withNeither.length > 0) {
      console.log(`⚠️   ${withNeither.length} empleado(s) sin CURP ni NSS quedaron SIN credencial — no pueden hacer login todavía.\n`)
    } else {
      console.log('')
    }
  } finally {
    await pg.end()
  }

  await prisma.$disconnect()
}

main().catch((err) => {
  console.error('\n❌  Error en el provisioning:', err.message)
  process.exit(1)
})

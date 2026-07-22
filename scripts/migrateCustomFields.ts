#!/usr/bin/env ts-node
// ============================================================
// CÓDICE · migrateCustomFields.ts
// Backfill: agrega employees.custom_fields en el schema de cada
// tenant YA provisionado. Los tenants nuevos la reciben
// automáticamente vía provisionTenant.ts + tenant-schema.sql —
// este script es solo para los que ya existían antes de este cambio.
//
// Uso:
//   npx ts-node scripts/migrateCustomFields.ts
// ============================================================

import { PrismaClient } from '@prisma/client'
import { Client as PgClient } from 'pg'

function customFieldsSQL(schema: string): string {
  return `
    ALTER TABLE "${schema}".employees ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}';
  `
}

async function main() {
  console.log('\n🚀 CÓDICE · Backfill de employees.custom_fields\n')

  const prisma = new PrismaClient({ log: ['error'] })
  const tenants = await prisma.tenant.findMany({ select: { id: true, slug: true, dbSchema: true } })

  if (tenants.length === 0) {
    console.log('ℹ️  No hay tenants provisionados todavía.')
    await prisma.$disconnect()
    return
  }

  const pg = new PgClient({ connectionString: process.env.DATABASE_URL })
  await pg.connect()

  try {
    for (const t of tenants) {
      process.stdout.write(`⚙️  ${t.slug} (${t.dbSchema})... `)
      await pg.query(customFieldsSQL(t.dbSchema))
      console.log('✅')
    }
  } finally {
    await pg.end()
  }

  await prisma.$disconnect()
  console.log(`\n✅  employees.custom_fields lista en ${tenants.length} tenant(s)\n`)
}

main().catch((err) => {
  console.error('\n❌  Error en la migración:', err.message)
  process.exit(1)
})

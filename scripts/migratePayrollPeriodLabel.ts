#!/usr/bin/env ts-node
// ============================================================
// CÓDICE · migratePayrollPeriodLabel.ts
// Backfill: agrega la columna payroll_records.period_label en el
// schema de cada tenant YA provisionado — necesaria para que el
// conector Excel genérico pueda hacer upsert de recibos de nómina
// sin folio/UUID fiscal (llave: employee_id + period_label + payment_date).
// Los tenants nuevos la reciben automáticamente vía provisionTenant.ts +
// tenant-schema.sql — este script es solo para los que ya existían.
//
// Uso:
//   npx ts-node scripts/migratePayrollPeriodLabel.ts
// ============================================================

import { PrismaClient } from '@prisma/client'
import { Client as PgClient } from 'pg'

function addPeriodLabelSQL(schema: string): string {
  return `ALTER TABLE "${schema}".payroll_records ADD COLUMN IF NOT EXISTS period_label TEXT;`
}

async function main() {
  console.log('\n🚀 CÓDICE · Backfill de payroll_records.period_label\n')

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
      await pg.query(addPeriodLabelSQL(t.dbSchema))
      console.log('✅')
    }
  } finally {
    await pg.end()
  }

  await prisma.$disconnect()
  console.log(`\n✅  period_label agregada en ${tenants.length} tenant(s)\n`)
}

main().catch((err) => {
  console.error('\n❌  Error en la migración:', err.message)
  process.exit(1)
})

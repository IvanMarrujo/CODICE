#!/usr/bin/env ts-node
// ============================================================
// CÓDICE · migrateGamification.ts
// Backfill: agrega employees.badges y crea la tabla xp_events en
// el schema de cada tenant YA provisionado. Los tenants nuevos las
// reciben automáticamente vía provisionTenant.ts + tenant-schema.sql —
// este script es solo para los que ya existían antes de este cambio.
//
// Uso:
//   npx ts-node scripts/migrateGamification.ts
// ============================================================

import { PrismaClient } from '@prisma/client'
import { Client as PgClient } from 'pg'

function gamificationSQL(schema: string): string {
  return `
    ALTER TABLE "${schema}".employees ADD COLUMN IF NOT EXISTS badges JSONB DEFAULT '[]';

    CREATE TABLE IF NOT EXISTS "${schema}".xp_events (
      id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      employee_id     TEXT        REFERENCES "${schema}".employees(id) ON DELETE CASCADE,
      type            TEXT        NOT NULL,
      xp_earned       INTEGER     NOT NULL,
      description     TEXT,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_xp_events_emp  ON "${schema}".xp_events (employee_id);
    CREATE INDEX IF NOT EXISTS idx_xp_events_date ON "${schema}".xp_events (created_at DESC);
  `
}

async function main() {
  console.log('\n🚀 CÓDICE · Backfill de gamificación (badges + xp_events)\n')

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
      await pg.query(gamificationSQL(t.dbSchema))
      console.log('✅')
    }
  } finally {
    await pg.end()
  }

  await prisma.$disconnect()
  console.log(`\n✅  Gamificación (badges + xp_events) lista en ${tenants.length} tenant(s)\n`)
}

main().catch((err) => {
  console.error('\n❌  Error en la migración:', err.message)
  process.exit(1)
})

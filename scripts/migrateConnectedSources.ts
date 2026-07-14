#!/usr/bin/env ts-node
// ============================================================
// CÓDICE · migrateConnectedSources.ts
// Backfill: crea la tabla connected_sources (live-wire file
// connections) en el schema de cada tenant YA provisionado.
// Los tenants nuevos la reciben automáticamente vía
// provisionTenant.ts + tenant-schema.sql — este script es solo
// para los que ya existían antes de este cambio.
//
// Uso:
//   npx ts-node scripts/migrateConnectedSources.ts
// ============================================================

import { PrismaClient } from '@prisma/client'
import { Client as PgClient } from 'pg'

function connectedSourcesSQL(schema: string): string {
  return `
    CREATE TABLE IF NOT EXISTS "${schema}".connected_sources (
      id                    TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      tenant_id             TEXT        NOT NULL,
      type                  TEXT        NOT NULL,
      file_name             TEXT        NOT NULL,
      file_content           TEXT        NOT NULL,
      checksum              TEXT        NOT NULL,
      auto_sync             BOOLEAN     DEFAULT false,
      sync_interval_minutes INTEGER     DEFAULT 15,
      status                TEXT        DEFAULT 'CONNECTED',
      last_error            TEXT,
      last_read_at          TIMESTAMPTZ,
      last_modified_at      TIMESTAMPTZ DEFAULT NOW(),
      created_at            TIMESTAMPTZ DEFAULT NOW(),
      updated_at            TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT uq_connected_source_type UNIQUE (tenant_id, type)
    );

    CREATE INDEX IF NOT EXISTS idx_connected_sources_tenant ON "${schema}".connected_sources (tenant_id);

    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_updated_at'
          AND tgrelid = '"${schema}".connected_sources'::regclass
      ) THEN
        CREATE TRIGGER trg_updated_at BEFORE UPDATE ON "${schema}".connected_sources
        FOR EACH ROW EXECUTE FUNCTION "${schema}".set_updated_at();
      END IF;
    END $$;
  `
}

async function main() {
  console.log('\n🚀 CÓDICE · Backfill de connected_sources\n')

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
      await pg.query(connectedSourcesSQL(t.dbSchema))
      console.log('✅')
    }
  } finally {
    await pg.end()
  }

  await prisma.$disconnect()
  console.log(`\n✅  connected_sources creada en ${tenants.length} tenant(s)\n`)
}

main().catch((err) => {
  console.error('\n❌  Error en la migración:', err.message)
  process.exit(1)
})

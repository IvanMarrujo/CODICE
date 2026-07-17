#!/usr/bin/env ts-node
// ============================================================
// CÓDICE · migrateZktecoDevices.ts
// Backfill: crea la tabla `zkteco_devices` en el schema de cada tenant
// YA provisionado (mismo patrón que scripts/migrateConnectedSources.ts),
// más la tabla GLOBAL `public.zkteco_devices` (sn → tenant_id, usada por
// el webhook ADMS para resolver el tenant de un dispositivo — ver
// routes/zktecoWebhook.ts). Los tenants nuevos reciben la tabla de tenant
// automáticamente vía provisionTenant.ts + tenant-schema.sql.
//
// Uso:
//   npx ts-node scripts/migrateZktecoDevices.ts
// ============================================================

import { PrismaClient } from '@prisma/client'
import { Client as PgClient } from 'pg'

function tenantTableSQL(schema: string): string {
  return `
    CREATE TABLE IF NOT EXISTS "${schema}".zkteco_devices (
      id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      tenant_id   TEXT        NOT NULL,
      sn          TEXT        NOT NULL UNIQUE,
      alias       TEXT,
      location    TEXT,
      ip_address  TEXT,
      model       TEXT        DEFAULT 'UA760',
      last_ping   TIMESTAMPTZ,
      status      TEXT        DEFAULT 'ACTIVE',
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_zkteco_devices_tenant ON "${schema}".zkteco_devices (tenant_id);

    ALTER TABLE "${schema}".attendance_records ADD COLUMN IF NOT EXISTS verify_mode TEXT;
    ALTER TABLE "${schema}".attendance_records ADD COLUMN IF NOT EXISTS device_sn   TEXT;
    ALTER TABLE "${schema}".attendance_records ADD COLUMN IF NOT EXISTS mock        BOOLEAN DEFAULT true;
  `
}

const PUBLIC_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS public.zkteco_devices (
    sn            TEXT        PRIMARY KEY,
    tenant_id     TEXT        NOT NULL,
    alias         TEXT,
    registered_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_zkteco_devices_public_tenant ON public.zkteco_devices (tenant_id);
`

async function main() {
  console.log('\n🚀 CÓDICE · Backfill de zkteco_devices (ZKTeco ADMS)\n')

  const prisma = new PrismaClient({ log: ['error'] })
  const tenants = await prisma.tenant.findMany({ select: { id: true, slug: true, dbSchema: true } })

  const pg = new PgClient({ connectionString: process.env.DATABASE_URL })
  await pg.connect()

  try {
    process.stdout.write('⚙️  Tabla global public.zkteco_devices... ')
    await pg.query(PUBLIC_TABLE_SQL)
    console.log('✅')

    for (const t of tenants) {
      process.stdout.write(`⚙️  ${t.slug} (${t.dbSchema})... `)
      await pg.query(tenantTableSQL(t.dbSchema))
      console.log('✅')
    }
  } finally {
    await pg.end()
  }

  await prisma.$disconnect()
  console.log(`\n✅  Backfill completo — ${tenants.length} tenant(s) + tabla global\n`)
}

main().catch((err) => {
  console.error('\n❌  Error en la migración:', err.message)
  process.exit(1)
})

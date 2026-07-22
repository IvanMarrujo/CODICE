#!/usr/bin/env ts-node
// ============================================================
// CÓDICE · migrateActaSignatures.ts
// Backfill: crea la tabla acta_signatures (testigo digital / cadena de
// custodia para actas administrativas) y agrega las columnas de firma
// a `actas`, en el schema de cada tenant YA provisionado. Los tenants
// nuevos las reciben automáticamente vía provisionTenant.ts +
// tenant-schema.sql — este script es solo para los que ya existían
// antes de este cambio.
//
// Uso:
//   npx ts-node scripts/migrateActaSignatures.ts
// ============================================================

import { PrismaClient } from '@prisma/client'
import { Client as PgClient } from 'pg'

function actaSignaturesSQL(schema: string): string {
  return `
    CREATE TABLE IF NOT EXISTS "${schema}".acta_signatures (
      id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      acta_id         TEXT        REFERENCES "${schema}".actas(id) ON DELETE CASCADE,
      employee_id     TEXT        REFERENCES "${schema}".employees(id),
      role            TEXT        NOT NULL, -- 'subject' | 'witness_1' | 'witness_2' | 'hr_manager'
      signed_at       TIMESTAMPTZ,
      signature_hash  TEXT,
      ip_address      TEXT,
      device_info     TEXT,
      location_lat    NUMERIC,
      location_lng    NUMERIC,
      location_mock   BOOLEAN     DEFAULT true,
      declined        BOOLEAN     DEFAULT false,
      declined_reason TEXT,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT uq_acta_signature_role UNIQUE (acta_id, role)
    );
    CREATE INDEX IF NOT EXISTS idx_acta_signatures_acta ON "${schema}".acta_signatures (acta_id);

    ALTER TABLE "${schema}".actas ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Borrador';
    ALTER TABLE "${schema}".actas ADD COLUMN IF NOT EXISTS document_hash TEXT;
    ALTER TABLE "${schema}".actas ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;
    ALTER TABLE "${schema}".actas ADD COLUMN IF NOT EXISTS signature_count INTEGER DEFAULT 0;
  `
}

async function main() {
  console.log('\n🚀 CÓDICE · Backfill de testigo digital (acta_signatures)\n')

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
      await pg.query(actaSignaturesSQL(t.dbSchema))
      console.log('✅')
    }
  } finally {
    await pg.end()
  }

  await prisma.$disconnect()
  console.log(`\n✅  acta_signatures lista en ${tenants.length} tenant(s)\n`)
}

main().catch((err) => {
  console.error('\n❌  Error en la migración:', err.message)
  process.exit(1)
})

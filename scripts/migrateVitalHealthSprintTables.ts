#!/usr/bin/env ts-node
// ============================================================
// CÓDICE · migrateVitalHealthSprintTables.ts
// Backfill: crea las 7 tablas que faltaban en tenants YA provisionados
// (gfp, vitalhealth) — tenant-schema.sql se actualizó para incluirlas en
// tenants nuevos (feat/vital-health-sprint + supervisor-shell/actas), pero
// nunca corrió una migración de backfill para los que ya existían. Sin
// esto, POST /api/lft/separation, /api/contracts/templates/*,
// /api/reports, /api/supervisor/incidents y las firmas de actas devuelven
// 500 ("relation does not exist") en cualquier tenant viejo.
//
// Tablas: contract_templates, exit_letter_templates, separation_processes,
// report_templates, tenant_documents, supervisor_incidents, acta_signatures.
//
// Idempotente — CREATE TABLE/INDEX IF NOT EXISTS, seguro para re-correr.
// acta_signatures tiene FK a `actas`: si esa tabla no existe todavía en
// algún tenant, se reporta y se salta (no se crea `actas` aquí, es una
// feature anterior sin relación con este sprint).
//
// Uso:
//   npx ts-node scripts/migrateVitalHealthSprintTables.ts
// ============================================================

import { PrismaClient } from '@prisma/client'
import { Client as PgClient } from 'pg'

function tablesSQL(schema: string): string {
  return `
    CREATE TABLE IF NOT EXISTS "${schema}".supervisor_incidents (
      id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      tenant_id       TEXT        NOT NULL,
      employee_id     TEXT        REFERENCES "${schema}".employees(id) ON DELETE CASCADE,
      reported_by     TEXT        NOT NULL,
      type            TEXT        NOT NULL,
      description     TEXT,
      severity        TEXT        NOT NULL,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_supervisor_incidents_emp      ON "${schema}".supervisor_incidents (employee_id);
    CREATE INDEX IF NOT EXISTS idx_supervisor_incidents_reporter ON "${schema}".supervisor_incidents (reported_by);
    CREATE INDEX IF NOT EXISTS idx_supervisor_incidents_date     ON "${schema}".supervisor_incidents (created_at DESC);

    CREATE TABLE IF NOT EXISTS "${schema}".contract_templates (
      id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      tenant_id         TEXT        NOT NULL,
      nombre            TEXT        NOT NULL,
      tipo              TEXT,
      puesto_aplica     JSONB       DEFAULT '[]',
      clausulas         JSONB       DEFAULT '[]',
      campos_variables  JSONB       DEFAULT '[]',
      disposiciones     TEXT,
      archivo_url       TEXT,
      ia_analysis       JSONB,
      created_by        TEXT,
      created_at        TIMESTAMPTZ DEFAULT NOW(),
      updated_at        TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_contract_templates_tenant ON "${schema}".contract_templates (tenant_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS "${schema}".exit_letter_templates (
      id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      tenant_id         TEXT        NOT NULL,
      nombre            TEXT        NOT NULL,
      tipo              TEXT,
      disposiciones     TEXT,
      archivo_url       TEXT,
      ia_analysis       JSONB,
      created_by        TEXT,
      created_at        TIMESTAMPTZ DEFAULT NOW(),
      updated_at        TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_exit_letter_templates_tenant ON "${schema}".exit_letter_templates (tenant_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS "${schema}".separation_processes (
      id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      tenant_id         TEXT        NOT NULL,
      folio             TEXT,
      employee_id       TEXT        REFERENCES "${schema}".employees(id) ON DELETE SET NULL,
      tipo              TEXT        NOT NULL,
      respuestas        JSONB       DEFAULT '{}',
      calculo           JSONB       DEFAULT '{}',
      documentos        JSONB       DEFAULT '[]',
      firmas            JSONB       DEFAULT '[]',
      status            TEXT        DEFAULT 'Iniciado',
      created_by        TEXT,
      created_at        TIMESTAMPTZ DEFAULT NOW(),
      updated_at        TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_separation_processes_tenant ON "${schema}".separation_processes (tenant_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS "${schema}".report_templates (
      id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      tenant_id         TEXT        NOT NULL,
      nombre            TEXT        NOT NULL,
      pregunta          TEXT        NOT NULL,
      filtros           JSONB       DEFAULT '{}',
      created_by        TEXT,
      created_at        TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_report_templates_tenant ON "${schema}".report_templates (tenant_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS "${schema}".tenant_documents (
      id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      tenant_id         TEXT        NOT NULL,
      type              TEXT        NOT NULL,
      nombre            TEXT,
      archivo_url       TEXT,
      mime_type         TEXT,
      uploaded_by       TEXT,
      created_at        TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT uq_tenant_document_type UNIQUE (tenant_id, type)
    );
    CREATE INDEX IF NOT EXISTS idx_tenant_documents_tenant ON "${schema}".tenant_documents (tenant_id, type);

    -- updated_at auto-refresh — paridad con tenants nuevos (tenant-schema.sql
    -- corre esto para las 3 tablas de arriba que tienen updated_at, vía el
    -- DO $$ ... FOREACH ... $$ de provisionTenant; los tenants viejos nunca
    -- lo corrieron para estas tablas porque no existían en su momento).
    DROP TRIGGER IF EXISTS trg_updated_at ON "${schema}".contract_templates;
    CREATE TRIGGER trg_updated_at BEFORE UPDATE ON "${schema}".contract_templates
      FOR EACH ROW EXECUTE FUNCTION "${schema}".set_updated_at();

    DROP TRIGGER IF EXISTS trg_updated_at ON "${schema}".exit_letter_templates;
    CREATE TRIGGER trg_updated_at BEFORE UPDATE ON "${schema}".exit_letter_templates
      FOR EACH ROW EXECUTE FUNCTION "${schema}".set_updated_at();

    DROP TRIGGER IF EXISTS trg_updated_at ON "${schema}".separation_processes;
    CREATE TRIGGER trg_updated_at BEFORE UPDATE ON "${schema}".separation_processes
      FOR EACH ROW EXECUTE FUNCTION "${schema}".set_updated_at();
  `
}

// acta_signatures FK a `actas` — se crea aparte para poder saltarla con un
// mensaje claro si `actas` no existe en algún tenant, en vez de tronar.
function actaSignaturesSQL(schema: string): string {
  return `
    CREATE TABLE IF NOT EXISTS "${schema}".acta_signatures (
      id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      acta_id         TEXT        REFERENCES "${schema}".actas(id) ON DELETE CASCADE,
      employee_id     TEXT        REFERENCES "${schema}".employees(id),
      role            TEXT        NOT NULL,
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
  `
}

async function main() {
  console.log('\n🚀 CÓDICE · Backfill de tablas del sprint Vital Health + supervisor/actas\n')

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
      await pg.query(tablesSQL(t.dbSchema))
      console.log('✅ 6 tablas')

      const actasExists = await pg.query(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'actas') AS exists`,
        [t.dbSchema]
      )
      if (actasExists.rows[0].exists) {
        await pg.query(actaSignaturesSQL(t.dbSchema))
        console.log(`    acta_signatures: ✅`)
      } else {
        console.log(`    acta_signatures: ⚠️  omitida — "actas" no existe en ${t.slug}`)
      }
    }
  } finally {
    await pg.end()
  }

  await prisma.$disconnect()
  console.log(`\n✅  Backfill listo en ${tenants.length} tenant(s)\n`)
}

main().catch((err) => {
  console.error('\n❌  Error en la migración:', err.message)
  process.exit(1)
})

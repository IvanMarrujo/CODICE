#!/usr/bin/env ts-node
// ============================================================
// CÓDICE · migrateSupervisorShell.ts
// Backfill: agrega employees.supervisor_name y la tabla
// supervisor_incidents en el schema de cada tenant YA provisionado.
// Los tenants nuevos las reciben automáticamente vía
// provisionTenant.ts + tenant-schema.sql — este script es solo
// para los que ya existían antes de este cambio.
//
// NOTA: AdminUser.assignedDepartment vive en el schema PÚBLICO (Prisma,
// no SQL crudo) — ese campo se sincroniza con `npm run db:push` desde
// packages/database, no con este script. Correr ambos.
//
// Uso:
//   npx ts-node scripts/migrateSupervisorShell.ts
// ============================================================

import { PrismaClient } from '@prisma/client'
import { Client as PgClient } from 'pg'

function migrationSQL(schema: string): string {
  return `
    ALTER TABLE "${schema}".employees ADD COLUMN IF NOT EXISTS supervisor_name TEXT;

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
  `
}

async function main() {
  console.log('\n🚀 CÓDICE · Backfill de Supervisor Shell (supervisor_name + supervisor_incidents)\n')

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
      await pg.query(migrationSQL(t.dbSchema))
      console.log('✅')
    }
  } finally {
    await pg.end()
  }

  await prisma.$disconnect()
  console.log(`\n✅  supervisor_name + supervisor_incidents listas en ${tenants.length} tenant(s)`)
  console.log(`⚠️  Falta: npm run db:push --workspace=packages/database (agrega AdminUser.assignedDepartment al schema público)\n`)
}

main().catch((err) => {
  console.error('\n❌  Error en la migración:', err.message)
  process.exit(1)
})

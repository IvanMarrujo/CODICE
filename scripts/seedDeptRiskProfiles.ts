#!/usr/bin/env ts-node
// ============================================================
// CÓDICE · seedDeptRiskProfiles.ts
// Backfill: crea department_risk_profiles + radar_digests (CÓDICE
// Radar) en el schema de cada tenant YA provisionado — mismo patrón
// que scripts/migrateConnectedSources.ts. Los tenants nuevos las
// reciben automáticamente vía provisionTenant.ts + tenant-schema.sql.
//
// Además, pre-siembra department_risk_profiles con la KB estática
// (occupational-risk-kb.ts) para los departamentos reales del tenant
// objetivo (por defecto: el único tenant de este deployment, GFP).
//
// Uso:
//   npx ts-node scripts/seedDeptRiskProfiles.ts
//   npx ts-node scripts/seedDeptRiskProfiles.ts --tenant cf04654a1dd0a30d7
// ============================================================

import { PrismaClient } from '@prisma/client'
import { Client as PgClient } from 'pg'
import { OCCUPATIONAL_RISK_KB, GENERIC_DEPARTMENT_PROFILE, OccupationalNorma } from '../apps/api/src/data/occupational-risk-kb'

const args = process.argv.slice(2).reduce((acc, val, i, arr) => {
  if (val.startsWith('--')) acc[val.slice(2)] = arr[i + 1]
  return acc
}, {} as Record<string, string>)

function tablesSQL(schema: string): string {
  return `
    CREATE TABLE IF NOT EXISTS "${schema}".department_risk_profiles (
      id                    TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      tenant_id             TEXT        NOT NULL,
      department            TEXT        NOT NULL,
      perfil_optimo         JSONB       DEFAULT '{}',
      riesgos_ocupacionales JSONB       DEFAULT '[]',
      historial_accidentes  JSONB       DEFAULT '[]',
      alertas_automaticas   JSONB       DEFAULT '[]',
      fuentes_normativas    JSONB       DEFAULT '[]',
      ultima_revision       DATE,
      updated_at            TIMESTAMPTZ DEFAULT NOW(),
      updated_by            TEXT,
      CONSTRAINT uq_dept_risk UNIQUE (tenant_id, department)
    );
    CREATE INDEX IF NOT EXISTS idx_dept_risk_tenant ON "${schema}".department_risk_profiles (tenant_id);

    CREATE TABLE IF NOT EXISTS "${schema}".radar_digests (
      id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      tenant_id         TEXT        NOT NULL,
      generated_at      TIMESTAMPTZ DEFAULT NOW(),
      items             JSONB       DEFAULT '[]',
      alta_count        INTEGER     DEFAULT 0,
      media_count       INTEGER     DEFAULT 0,
      baja_count        INTEGER     DEFAULT 0,
      sources_searched  JSONB       DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_radar_digests_tenant ON "${schema}".radar_digests (tenant_id, generated_at DESC);

    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_updated_at'
          AND tgrelid = '"${schema}".department_risk_profiles'::regclass
      ) THEN
        CREATE TRIGGER trg_updated_at BEFORE UPDATE ON "${schema}".department_risk_profiles
        FOR EACH ROW EXECUTE FUNCTION "${schema}".set_updated_at();
      END IF;
    END $$;
  `
}

function normasFor(department: string): OccupationalNorma[] {
  // Deptos de manufactura/almacén/empaque toman las normas de esas
  // categorías + las de "todos" (NOM-035 aplica siempre).
  const CATEGORY_BY_DEPT: Record<string, string[]> = {
    'Producción':            ['manufactura', 'alimentos'],
    'Empaque':                ['manufactura', 'empaque'],
    'Calidad e Inocuidad':    ['manufactura', 'alimentos'],
    'Almacén y Logística':    ['almacen', 'logistica'],
    'Mantenimiento':          ['manufactura'],
    'Recursos Humanos':       [],
  }
  const cats = CATEGORY_BY_DEPT[department] ?? []
  return OCCUPATIONAL_RISK_KB.normas.filter(
    (n) => n.aplicaA.includes('todos') || n.aplicaA.some((a) => cats.includes(a))
  )
}

function profileForDept(department: string) {
  const kb = OCCUPATIONAL_RISK_KB.riesgosPorDepartamento[department] ?? GENERIC_DEPARTMENT_PROFILE
  const normas = normasFor(department)

  return {
    perfilOptimo: {
      edadMin: 18,
      edadMax: 60,
      examenRequerido: kb.examenRequerido,
      condicionesIncompatibles: kb.condicionesIncompatibles,
    },
    riesgosOcupacionales: [
      ...kb.riesgosAltos.map((nombre) => ({ nombre, frecuencia: 'Alta' as const })),
      ...kb.enfermedadesComunes.map((nombre) => ({ nombre, frecuencia: 'Media' as const })),
    ],
    fuentesNormativas: normas.map((n) => ({ clave: n.clave, titulo: n.titulo, url: n.url })),
  }
}

async function seedTenantDepartments(pg: PgClient, schema: string, tenantId: string, departments: string[]) {
  for (const department of departments) {
    const profile = profileForDept(department)
    await pg.query(
      `INSERT INTO "${schema}".department_risk_profiles
         (tenant_id, department, perfil_optimo, riesgos_ocupacionales, fuentes_normativas, ultima_revision, updated_by)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, CURRENT_DATE, 'system:seed')
       ON CONFLICT (tenant_id, department) DO UPDATE SET
         perfil_optimo         = EXCLUDED.perfil_optimo,
         riesgos_ocupacionales = EXCLUDED.riesgos_ocupacionales,
         fuentes_normativas    = EXCLUDED.fuentes_normativas,
         ultima_revision       = CURRENT_DATE,
         updated_by            = 'system:seed'
       WHERE "${schema}".department_risk_profiles.updated_by = 'system:seed'
          OR "${schema}".department_risk_profiles.updated_by IS NULL`,
      [tenantId, department, JSON.stringify(profile.perfilOptimo), JSON.stringify(profile.riesgosOcupacionales), JSON.stringify(profile.fuentesNormativas)]
    )
    console.log(`   · ${department}`)
  }
}

async function main() {
  console.log('\n🚀 CÓDICE Radar · Backfill de department_risk_profiles + radar_digests\n')

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
      process.stdout.write(`⚙️  Tablas en ${t.slug} (${t.dbSchema})... `)
      await pg.query(tablesSQL(t.dbSchema))
      console.log('✅')
    }

    const targetId = args.tenant
    const target = targetId
      ? tenants.find((t) => t.id === targetId)
      : (tenants.find((t) => t.slug === 'gfp') ?? tenants[0])

    if (!target) {
      console.error(`❌  No se encontró el tenant objetivo${targetId ? ` (${targetId})` : ''}.`)
    } else {
      console.log(`\n🌱  Sembrando perfiles de riesgo para ${target.slug} (${target.id})...`)

      const deptRows = await pg.query(
        `SELECT DISTINCT department FROM "${target.dbSchema}".employees WHERE department IS NOT NULL AND department != ''`
      )
      const realDepts: string[] = deptRows.rows.map((r: any) => r.department)
      const kbDepts = Object.keys(OCCUPATIONAL_RISK_KB.riesgosPorDepartamento)
      const departments = [...new Set([...kbDepts, ...realDepts])]

      await seedTenantDepartments(pg, target.dbSchema, target.id, departments)
      console.log(`\n✅  ${departments.length} departamento(s) sembrado(s) para ${target.slug}`)
    }
  } finally {
    await pg.end()
  }

  await prisma.$disconnect()
  console.log('\n✅  Backfill de CÓDICE Radar completo\n')
}

main().catch((err) => {
  console.error('\n❌  Error en el backfill:', err.message)
  process.exit(1)
})

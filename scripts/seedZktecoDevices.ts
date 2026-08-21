#!/usr/bin/env ts-node
// ============================================================
// CÓDICE · seedZktecoDevices.ts
// Crea la tabla GLOBAL `public.zkteco_devices` — la fuente de verdad
// para resolver SN → tenant_id que usa el webhook ADMS (ver
// routes/zktecoWebhook.ts) y el alta/baja de dispositivos (routes/devices.ts).
//
// Esta tabla NO es por-tenant: el webhook no sabe a qué tenant pertenece un
// SN hasta consultarla, así que vive en el schema `public` con `sn` como PK
// único entre todos los tenants. Las tablas `zkteco_devices` POR TENANT las
// crea tenant-schema.sql (tenants nuevos) y scripts/migrateZktecoDevices.ts
// (backfill de tenants existentes) — este script solo se ocupa de la global.
//
// Self-contained (solo `pg`, sin Prisma) para poder correrlo contra cualquier
// entorno sin depender de `prisma generate`. Idempotente: CREATE TABLE IF NOT
// EXISTS + backfill ON CONFLICT DO NOTHING. Se puede correr N veces.
//
// Uso:
//   DATABASE_URL=... npx ts-node scripts/seedZktecoDevices.ts
// ============================================================

import { Client as PgClient } from 'pg'

// DDL exacto que esperan devices.ts / zktecoWebhook.ts:
//   INSERT INTO public.zkteco_devices (sn, tenant_id, alias)
//   SELECT tenant_id FROM public.zkteco_devices WHERE sn = $1
//   DELETE FROM public.zkteco_devices WHERE sn = $1 AND tenant_id = $2
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
  console.log('\n🚀 CÓDICE · Seed de public.zkteco_devices (resolución SN → tenant)\n')

  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL no seteado')

  // Interno de Railway (railway.internal) o local → conexión directa. Contra el
  // proxy público (host remoto) el cert es self-signed: se relaja la verificación
  // scoped a ESTA conexión (no toca el TLS global del proceso).
  const remoteProxy = !/localhost|127\.0\.0\.1|railway\.internal/.test(url)
  const pg = new PgClient({
    connectionString: url,
    ...(remoteProxy ? { ssl: { rejectUnauthorized: false } } : {}),
  })
  await pg.connect()

  try {
    process.stdout.write('⚙️  Tabla global public.zkteco_devices... ')
    await pg.query(PUBLIC_TABLE_SQL)
    console.log('✅')

    // Lista de tenants provisionados (schema `public`, tabla "Tenant" de Prisma).
    const tenants = await pg.query<{ slug: string; dbSchema: string }>(
      `SELECT slug, "dbSchema" FROM public."Tenant" ORDER BY slug`
    )

    // Backfill: si un tenant ya tiene dispositivos en su tabla de tenant,
    // reflejarlos en la global para que su SN sea resoluble desde ya.
    let backfilled = 0
    for (const t of tenants.rows) {
      const hasTable = await pg.query<{ t: string | null }>(
        `SELECT to_regclass($1) AS t`, [`"${t.dbSchema}".zkteco_devices`]
      )
      if (!hasTable.rows[0].t) {
        console.log(`   ↳ ${t.slug}: sin tabla de tenant, se omite backfill`)
        continue
      }
      const r = await pg.query(
        `INSERT INTO public.zkteco_devices (sn, tenant_id, alias)
         SELECT sn, tenant_id, alias FROM "${t.dbSchema}".zkteco_devices
         ON CONFLICT (sn) DO NOTHING`
      )
      if (r.rowCount) {
        backfilled += r.rowCount
        console.log(`   ↳ ${t.slug}: ${r.rowCount} dispositivo(s) backfilleado(s) a la global`)
      }
    }

    const total = await pg.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM public.zkteco_devices')
    console.log(`\n✅  public.zkteco_devices lista — ${total.rows[0].n} fila(s) (${backfilled} backfilleada(s) esta corrida)\n`)
  } finally {
    await pg.end()
  }
}

main().catch((err) => {
  console.error('\n❌  Error en el seed:', err.message)
  process.exit(1)
})

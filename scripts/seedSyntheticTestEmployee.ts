#!/usr/bin/env ts-node
// ============================================================
// CÓDICE · seedSyntheticTestEmployee.ts
//
// Empleado de prueba reusable para verificar "en vivo" cualquier feature
// que escriba filas reales (contratos, separación laboral, nómina,
// asistencia, etc.) sin tocar el historial de una persona real ni en
// producción ni en local. Ver .claude/CODICE_DEV_PROTOCOL.md → "Pruebas
// contra datos reales / producción" — es la forma estándar del proyecto,
// cualquier terminal futura debe reusar este script en vez de inventar
// su propio empleado de prueba o usar uno real existente.
//
// El empleado es obviamente falso: nombre "ZZZ PRUEBA QA", CURP/NSS con
// prefijo "QA" que nunca coincide con un documento real (CURP válida en
// formato pero con letras QA repetidas donde irían nombre/apellido/
// entidad reales; NSS puros nueves).
//
// Uso:
//   Insertar:  npx ts-node scripts/seedSyntheticTestEmployee.ts --tenant=vitalhealth
//   Limpiar:   npx ts-node scripts/seedSyntheticTestEmployee.ts --tenant=vitalhealth --cleanup
//
// El cleanup borra el empleado Y cualquier fila que otras tablas hayan
// generado referenciándolo por employee_id (RELATED_TABLES abajo) — no
// todas esas FKs son ON DELETE CASCADE (separation_processes es SET NULL,
// acta_signatures no tiene cláusula), así que un DELETE simple de
// `employees` no bastaría por sí solo para no dejar residuos.
//
// SIEMPRE correr --cleanup al terminar la verificación, en la misma
// sesión donde se insertó — no dejar empleados sintéticos residuales.
// ============================================================

import { PrismaClient } from '@prisma/client'
import { Client as PgClient } from 'pg'

const EMPLOYEE_CODE = 'ZZZ-QA-TEST'
const FIRST_NAME    = 'ZZZ'
const LAST_NAME     = 'PRUEBA QA'
// CURP con formato válido (18 chars, pasa el regex oficial) pero
// obviamente sintética — QA repetido donde irían iniciales/entidad reales.
const CURP = 'QAQA000101HQAQAQA0'
// NSS con formato válido (11 dígitos) pero un patrón que ningún NSS real
// de IMSS usa (los primeros 2 dígitos son subdelegación, nunca 99).
const NSS = '99999999999'

// Toda tabla del schema de tenant que referencia employees(id) — ver
// tenant-schema.sql. Se limpia explícitamente por employee_id en vez de
// confiar solo en ON DELETE CASCADE, porque no todas las FKs cascadean
// (separation_processes: SET NULL: dejaría el proceso huérfano en vez de
// borrarlo; acta_signatures: sin ON DELETE, bloquearía el DELETE del
// empleado si hay una fila apuntándolo).
const RELATED_TABLES = [
  'contracts', 'payroll_records', 'time_off', 'requests', 'attendance_records',
  'actas', 'supervisor_incidents', 'acta_signatures', 'course_progress',
  'mentions', 'xp_events', 'bonuses', 'notifications', 'health_profiles',
  'separation_processes',
]

function parseArgs() {
  const args = process.argv.slice(2)
  const tenantArg = args.find((a) => a.startsWith('--tenant='))
  const slug = tenantArg?.split('=')[1]
  const cleanup = args.includes('--cleanup')
  if (!slug) {
    console.error('❌ Falta --tenant=<slug> (ej. --tenant=vitalhealth)')
    process.exit(1)
  }
  return { slug, cleanup }
}

async function resolveTenant(prisma: PrismaClient, slug: string) {
  const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true, dbSchema: true } })
  if (!tenant) {
    console.error(`❌ No existe tenant "${slug}"`)
    process.exit(1)
  }
  return tenant
}

async function cleanup(pg: PgClient, schema: string, slug: string) {
  const existing = await pg.query(`SELECT id FROM "${schema}".employees WHERE employee_code = $1`, [EMPLOYEE_CODE])
  if (existing.rows.length === 0) {
    console.log(`ℹ️  No hay empleado sintético que limpiar en "${slug}".`)
    return
  }

  for (const row of existing.rows) {
    console.log(`🧹 Limpiando empleado sintético ${row.id} en "${slug}"...`)
    for (const table of RELATED_TABLES) {
      // No todos los tenants tienen todas las tablas al día (mismo problema
      // de "migración nunca corrida contra tenants ya provisionados" que
      // este script terminó destapando) — una tabla faltante no debe
      // abortar la limpieza del resto, solo se salta con una nota.
      let r
      try {
        r = await pg.query(`DELETE FROM "${schema}".${table} WHERE employee_id = $1`, [row.id])
      } catch (err: any) {
        if (err.code === '42P01') {
          console.log(`   ${table}: ⚠️  tabla no existe en este tenant, se omite`)
          continue
        }
        throw err
      }
      if (r.rowCount) console.log(`   ${table}: ${r.rowCount} fila(s) borrada(s)`)
    }
    await pg.query(`DELETE FROM "${schema}".employees WHERE id = $1`, [row.id])
  }
  console.log(`✅ Empleado sintético y registros relacionados borrados de "${slug}".`)
}

async function seed(pg: PgClient, schema: string, tenantId: string, slug: string) {
  const existing = await pg.query(`SELECT id FROM "${schema}".employees WHERE employee_code = $1`, [EMPLOYEE_CODE])
  if (existing.rows.length > 0) {
    console.log(`⚠️  Ya existe un empleado sintético en "${slug}" (id=${existing.rows[0].id}).`)
    console.log(`   Corre --cleanup antes de insertar uno nuevo:`)
    console.log(`   npx ts-node scripts/seedSyntheticTestEmployee.ts --tenant=${slug} --cleanup`)
    process.exit(1)
  }

  const rows = await pg.query(
    `INSERT INTO "${schema}".employees
      (tenant_id, employee_code, curp, nss, first_name, last_name, department, position, plant, shift,
       contract_type, hire_date, monthly_salary, daily_salary, status, source, email, phone)
     VALUES ($1,$2,$3,$4,$5,$6,'Sistemas','QA Tester','Planta de Pruebas','Matutino',
             'Indeterminado', CURRENT_DATE - INTERVAL '2 years', 15000, 500, 'Activo', 'MANUAL',
             'qa-test@example.invalid', '0000000000')
     RETURNING id, employee_code, full_name, curp, nss`,
    [tenantId, EMPLOYEE_CODE, CURP, NSS, FIRST_NAME, LAST_NAME]
  )

  console.log(`✅ Empleado sintético creado en "${slug}":`)
  console.log(`   `, rows.rows[0])
  console.log(`\n   Cuando termines de verificar, limpia con:`)
  console.log(`   npx ts-node scripts/seedSyntheticTestEmployee.ts --tenant=${slug} --cleanup`)
}

async function main() {
  const { slug, cleanup: doCleanup } = parseArgs()
  const prisma = new PrismaClient({ log: ['error'] })
  const tenant = await resolveTenant(prisma, slug)

  const pg = new PgClient({ connectionString: process.env.DATABASE_URL })
  await pg.connect()

  try {
    if (doCleanup) await cleanup(pg, tenant.dbSchema, slug)
    else await seed(pg, tenant.dbSchema, tenant.id, slug)
  } finally {
    await pg.end()
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error('❌ Error:', err.message)
  process.exit(1)
})

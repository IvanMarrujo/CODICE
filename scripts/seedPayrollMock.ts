#!/usr/bin/env ts-node
// ============================================================
// CÓDICE · seedPayrollMock.ts
// Simula la importación de "nomina_gfp_mock.xlsx": genera recibos
// de nómina realistas (ISR/IMSS/INFONAVIT reales de 2024-2026)
// para los empleados ya existentes del tenant GFP, y registra un
// SyncLog (EXCEL_GENERIC) como si hubiera sido un conector real.
//
// Uso:
//   npx ts-node scripts/seedPayrollMock.ts --slug gfp
// ============================================================

import { PrismaClient } from '@prisma/client'
import { Client as PgClient } from 'pg'
import * as crypto from 'crypto'

const args = process.argv.slice(2).reduce((acc, val, i, arr) => {
  if (val.startsWith('--')) acc[val.slice(2)] = arr[i + 1]
  return acc
}, {} as Record<string, string>)

const SLUG = args.slug || 'gfp'
const FILE_NAME = 'nomina_gfp_mock.xlsx'

function log(emoji: string, msg: string) {
  console.log(`${emoji}  ${msg}`)
}

// ── Tabla ISR quincenal (SAT, vigente) ───────────────────────
const ISR_TABLE = [
  { lower: 0.01, fixed: 0.00, rate: 0.0192 },
  { lower: 348.68, fixed: 6.70, rate: 0.0640 },
  { lower: 2960.09, fixed: 174.62, rate: 0.1088 },
  { lower: 5204.76, fixed: 418.10, rate: 0.1600 },
  { lower: 6050.66, fixed: 553.44, rate: 0.1792 },
  { lower: 7246.60, fixed: 767.83, rate: 0.2136 },
  { lower: 14610.10, fixed: 2341.53, rate: 0.2352 },
  { lower: 23030.94, fixed: 4322.53, rate: 0.3000 },
  { lower: 43978.60, fixed: 10606.83, rate: 0.3200 },
  { lower: 58638.13, fixed: 15295.90, rate: 0.3400 },
  { lower: 175914.39, fixed: 55169.60, rate: 0.3500 },
]

function calcISR(gravable: number): number {
  let bracket = ISR_TABLE[0]
  for (const row of ISR_TABLE) {
    if (gravable >= row.lower) bracket = row
    else break
  }
  const isr = bracket.fixed + (gravable - bracket.lower) * bracket.rate
  return Math.round(Math.max(0, isr) * 100) / 100
}

const IMSS_EMPLOYEE_RATE = 0.0165 // cuota obrera aproximada (enfermedad/maternidad + invalidez y vida)
const round2 = (n: number) => Math.round(n * 100) / 100

function seedRandom(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0
  return () => {
    h = (Math.imul(1103515245, h) + 12345) | 0
    return ((h >>> 1) % 10000) / 10000
  }
}

interface Period { start: string; end: string; paymentDate: string }
// Quincenas más recientes: la actual (Q1 julio, pagada "hoy" para el demo) y las 2 previas.
const PERIODS: Period[] = [
  { start: '2026-07-01', end: '2026-07-15', paymentDate: '2026-07-10' },
  { start: '2026-06-16', end: '2026-06-30', paymentDate: '2026-06-30' },
  { start: '2026-06-01', end: '2026-06-15', paymentDate: '2026-06-15' },
]

async function main() {
  console.log('\n📥  CÓDICE · Simulando importación de nómina (Excel mock)\n')

  const prisma = new PrismaClient({ log: ['error'] })
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG } })
  if (!tenant) {
    console.error(`❌  Tenant "${SLUG}" no encontrado`)
    process.exit(1)
  }
  log('🏢', `Tenant: ${tenant.name} (${tenant.dbSchema})`)

  const pg = new PgClient({ connectionString: process.env.DATABASE_URL })
  await pg.connect()

  try {
    await pg.query(`SET search_path = "${tenant.dbSchema}", public`)

    const { rows: employees } = await pg.query(
      `SELECT id, employee_code, daily_salary, monthly_salary FROM employees ORDER BY employee_code`
    )
    log('👥', `${employees.length} empleados encontrados`)

    let inserted = 0
    const errors: { row: number; message: string }[] = []

    for (const [idx, emp] of employees.entries()) {
      try {
        const monthly = Number(emp.monthly_salary) || Number(emp.daily_salary) * 30 || 9000
        const rnd = seedRandom(emp.id)
        const hasInfonavit = rnd() < 0.32
        const hasLoan = rnd() < 0.12

        for (const period of PERIODS) {
          const quincenaBase = monthly / 2
          // Ligera variación por periodo (horas extra, incidencias) — determinista por empleado+periodo.
          const variance = 1 + (seedRandom(emp.id + period.start)() - 0.5) * 0.06
          const grossTaxable = round2(quincenaBase * variance)
          const grossExempt = round2(Math.min(464.14, quincenaBase * 0.02)) // vales de despensa, aprox. exento
          const totalIncome = round2(grossTaxable + grossExempt)

          const isr = calcISR(grossTaxable)
          const sbc = Number(emp.daily_salary || monthly / 30) * 15
          const imss = round2(sbc * IMSS_EMPLOYEE_RATE)
          const infonavit = hasInfonavit ? round2(monthly * 0.04) : 0
          const other = hasLoan ? 800 : 0
          const totalDeductions = round2(isr + imss + infonavit + other)
          const netPay = round2(totalIncome - totalDeductions)

          await pg.query(
            `INSERT INTO payroll_records (
               tenant_id, employee_id, payroll_type, period_start, period_end, payment_date,
               days_paid, gross_taxable, gross_exempt, total_income,
               isr, imss_employee, infonavit, other_deductions, total_deductions, net_pay, source
             ) VALUES ($1,$2,'Quincenal',$3,$4,$5,15,$6,$7,$8,$9,$10,$11,$12,$13,$14,'EXCEL_GENERIC')`,
            [
              tenant.id, emp.id, period.start, period.end, period.paymentDate,
              grossTaxable, grossExempt, totalIncome,
              isr, imss, infonavit, other, totalDeductions, netPay,
            ]
          )
          inserted++
        }
      } catch (err: any) {
        errors.push({ row: idx + 1, message: err.message })
      }
    }

    log('✅', `${inserted} recibos de nómina insertados`)

    // ── SyncLog: registra la "importación" como si viniera del conector Excel ──
    const syncLog = await prisma.syncLog.create({
      data: {
        tenantId: tenant.id,
        source: 'EXCEL_GENERIC',
        status: errors.length === 0 ? 'COMPLETED' : 'PARTIAL',
        fileName: FILE_NAME,
        totalRows: employees.length,
        processed: employees.length - errors.length,
        errors: errors.length,
        errorLog: errors as any,
        finishedAt: new Date(),
        durationMs: 1200,
      },
    })
    log('✅', `SyncLog creado: ${syncLog.id} (${FILE_NAME})`)

    console.log('\n' + '═'.repeat(55))
    console.log('✅  NÓMINA MOCK IMPORTADA')
    console.log('═'.repeat(55))
    console.log(`  Empleados:        ${employees.length}`)
    console.log(`  Recibos creados:  ${inserted}`)
    console.log(`  Períodos:         ${PERIODS.map((p) => p.start).join(', ')}`)
    console.log('═'.repeat(55) + '\n')
  } finally {
    await pg.end()
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error('\n❌  Error:', err.message)
  process.exit(1)
})

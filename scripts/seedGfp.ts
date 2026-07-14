#!/usr/bin/env ts-node
// ============================================================
// CÓDICE · seedGfp.ts
// Siembra datos de demo realistas para el tenant piloto GFP:
//   25 empleados, 3 solicitudes pendientes, 2 cursos, 1 mención.
//
// Uso:
//   npx ts-node scripts/seedGfp.ts
// ============================================================

import * as path from 'path'
import * as dotenv from 'dotenv'
dotenv.config({ path: path.join(__dirname, '../.env') })

import { Client } from 'pg'

const TENANT_ID     = 'c1b551583c6739206'
const TENANT_SCHEMA = 'tenant_c1b551583c6739206'

function log(emoji: string, msg: string) {
  console.log(`${emoji}  ${msg}`)
}

function unaccent(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

// RFC persona física: 4 letras + 6 dígitos (AAMMDD) + 3 alfanuméricos (homoclave)
function genRFC(nombre: string, apellidoP: string, apellidoM: string, birth: { y: number; m: number; d: number }, idx: number): string {
  const ap = unaccent(apellidoP).toUpperCase()
  const am = unaccent(apellidoM).toUpperCase()
  const nm = unaccent(nombre).toUpperCase()
  const vowelMatch = ap.slice(1).match(/[AEIOU]/)
  const l1 = ap[0] || 'X'
  const l2 = vowelMatch ? vowelMatch[0] : 'X'
  const l3 = am[0] || 'X'
  const l4 = nm[0] || 'X'
  const yy = String(birth.y % 100).padStart(2, '0')
  const mm = String(birth.m).padStart(2, '0')
  const dd = String(birth.d).padStart(2, '0')
  const homoclave = String(idx).padStart(2, '0') + 'A'
  return `${l1}${l2}${l3}${l4}${yy}${mm}${dd}${homoclave}`
}

function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const DEPARTMENTS = ['Producción', 'Empaque', 'Calidad e Inocuidad', 'Mantenimiento', 'Almacén', 'Recursos Humanos']
const PLANTS       = ['Planta Vallejo', 'Planta Iztapalapa']
const SHIFTS       = ['Matutino', 'Vespertino', 'Nocturno']

const POSITIONS_BY_DEPT: Record<string, string[]> = {
  'Producción':           ['Operador de producción', 'Supervisor de línea'],
  'Empaque':              ['Operador de empaque', 'Auxiliar de empaque'],
  'Calidad e Inocuidad':  ['Analista de calidad', 'Inspector de inocuidad'],
  'Mantenimiento':        ['Técnico de mantenimiento', 'Electromecánico'],
  'Almacén':              ['Auxiliar de almacén', 'Montacarguista'],
  'Recursos Humanos':     ['Analista de RH', 'Gerente de RH'],
}

const SALARY_BY_POSITION: Record<string, number> = {
  'Operador de producción':      9200,
  'Supervisor de línea':         17500,
  'Operador de empaque':         8600,
  'Auxiliar de empaque':         8200,
  'Analista de calidad':         13800,
  'Inspector de inocuidad':      12600,
  'Técnico de mantenimiento':    15200,
  'Electromecánico':             16400,
  'Auxiliar de almacén':         8900,
  'Montacarguista':              10800,
  'Analista de RH':              14500,
  'Gerente de RH':               42000,
}

interface EmployeeSeed {
  firstName: string
  lastName1: string
  lastName2: string
  birth: { y: number; m: number; d: number }
  department: string
  plant: string
  shift: string
  contractType: string
  hireDate: string
  status: string
  xpPoints: number
}

const NAMES: [string, string, string, { y: number; m: number; d: number }][] = [
  ['María',        'García',    'López',     { y: 1990, m: 3,  d: 14 }],
  ['José',         'Martínez',  'Hernández', { y: 1985, m: 7,  d: 2  }],
  ['Guadalupe',    'Ramírez',   'Torres',    { y: 1993, m: 11, d: 27 }],
  ['Jesús',        'Rodríguez', 'Sánchez',   { y: 1988, m: 5,  d: 9  }],
  ['Alejandra',    'Pérez',     'Gómez',     { y: 1995, m: 1,  d: 21 }],
  ['Francisco',    'González',  'Cruz',      { y: 1979, m: 9,  d: 30 }],
  ['Itzel',        'Flores',    'Reyes',     { y: 1997, m: 4,  d: 18 }],
  ['Miguel Ángel', 'Morales',   'Jiménez',   { y: 1982, m: 12, d: 5  }],
  ['Fernanda',     'Ortiz',     'Ruiz',      { y: 1991, m: 6,  d: 23 }],
  ['Iván',         'Castillo',  'Vázquez',   { y: 1986, m: 8,  d: 11 }],
  ['Perla',        'Mendoza',   'Aguilar',   { y: 1994, m: 2,  d: 8  }],
  ['Rodrigo',      'Domínguez', 'Delgado',   { y: 1989, m: 10, d: 16 }],
  ['Ximena',       'Vargas',    'Romero',    { y: 1996, m: 3,  d: 3  }],
  ['Ángel',        'Guerrero',  'Medina',    { y: 1983, m: 7,  d: 25 }],
  ['Citlali',      'Rojas',     'Herrera',   { y: 1998, m: 5,  d: 30 }],
  ['Eduardo',      'Salazar',   'Chávez',    { y: 1987, m: 1,  d: 12 }],
  ['Araceli',      'Núñez',     'Contreras', { y: 1992, m: 9,  d: 19 }],
  ['Gerardo',      'Cabrera',   'Fuentes',   { y: 1980, m: 11, d: 4  }],
  ['Yolanda',      'Estrada',   'Peña',      { y: 1990, m: 4,  d: 27 }],
  ['Óscar',        'Cortés',    'Silva',     { y: 1984, m: 6,  d: 14 }],
  ['Alondra',      'Ibarra',    'Molina',    { y: 1999, m: 2,  d: 22 }],
  ['Ricardo',      'Campos',    'Espinoza',  { y: 1981, m: 8,  d: 7  }],
  ['Mariana',      'Luna',      'Cervantes', { y: 1993, m: 12, d: 29 }],
  ['Sergio',       'Reyna',     'Padilla',   { y: 1986, m: 3,  d: 16 }],
  ['Diana',        'Zamora',    'Vega',      { y: 1995, m: 10, d: 2  }],
]

const CONTRACT_TYPES = ['Indeterminado', 'Determinado', 'Periodo de prueba']

function buildEmployees(): EmployeeSeed[] {
  return NAMES.map((n, idx) => {
    const [firstName, lastName1, lastName2, birth] = n
    const department = DEPARTMENTS[idx % DEPARTMENTS.length]
    const plant      = PLANTS[idx % PLANTS.length]
    const shift      = SHIFTS[idx % SHIFTS.length]
    const contractType = idx % 7 === 0 ? 'Determinado' : idx % 11 === 0 ? 'Periodo de prueba' : 'Indeterminado'

    const hireYear  = 2018 + (idx % 7)
    const hireMonth = 1 + (idx % 12)
    const hireDay   = 1 + (idx % 27)

    // 20 Activo, 2 Vacaciones, 1 Incapacidad, 1 Permiso, 1 Baja pendiente (25 total)
    let status = 'Activo'
    if (idx === 20 || idx === 21) status = 'Vacaciones'
    else if (idx === 22) status = 'Incapacidad'
    else if (idx === 23) status = 'Permiso'
    else if (idx === 24) status = 'Baja pendiente'

    const xpPoints = idx === 6 ? 2450 : 300 + ((idx * 137) % 2000) // idx 6 (Itzel Flores) queda como top

    return {
      firstName, lastName1, lastName2, birth,
      department, plant, shift, contractType,
      hireDate: isoDate(hireYear, hireMonth, hireDay),
      status, xpPoints,
    }
  })
}

async function main() {
  console.log('\n🌱  CÓDICE · Seeding tenant GFP\n')

  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  await client.query(`SET search_path = "${TENANT_SCHEMA}", public`)

  // ── Limpieza idempotente (permite re-correr el seed sin duplicar) ──
  await client.query('DELETE FROM mentions')
  await client.query('DELETE FROM notifications')
  await client.query('DELETE FROM requests')
  await client.query('DELETE FROM course_progress')
  await client.query('DELETE FROM courses')
  await client.query('DELETE FROM employees')
  log('🧹', 'Datos previos del tenant limpiados')

  // ── 25 empleados ────────────────────────────────────────────
  const employees = buildEmployees()
  const employeeIds: string[] = []

  for (const [idx, emp] of employees.entries()) {
    const position = POSITIONS_BY_DEPT[emp.department][idx % 2]
    const monthlySalary = SALARY_BY_POSITION[position]
    const dailySalary   = Math.round((monthlySalary / 30) * 100) / 100
    const rfc = genRFC(emp.firstName, emp.lastName1, emp.lastName2, emp.birth, idx)
    const employeeCode = `GFP-${1000 + idx}`
    const email = `${unaccent(emp.firstName).toLowerCase().replace(/\s+/g, '.')}.${unaccent(emp.lastName1).toLowerCase()}@gfp.mx`

    const result = await client.query(
      `INSERT INTO employees (
         tenant_id, employee_code, rfc, first_name, last_name, department, position, plant, shift,
         contract_type, hire_date, daily_salary, monthly_salary, email, status, source, xp_points, xp_level
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'MANUAL',$16,$17)
       RETURNING id`,
      [
        TENANT_ID, employeeCode, rfc, emp.firstName, `${emp.lastName1} ${emp.lastName2}`,
        emp.department, position, emp.plant, emp.shift, emp.contractType, emp.hireDate,
        dailySalary, monthlySalary, email, emp.status, emp.xpPoints, 1 + Math.floor(emp.xpPoints / 500),
      ]
    )
    employeeIds.push(result.rows[0].id)
  }
  log('✅', `${employees.length} empleados insertados`)

  // ── 3 solicitudes pendientes (stage = MANAGER) ──────────────
  const pendingRequests = [
    { employeeIdx: 0, type: 'Vacaciones',         detail: '5 días, del 20 al 24 de julio 2026' },
    { employeeIdx: 3, type: 'Permiso',            detail: 'Permiso sin goce, cita médica familiar' },
    { employeeIdx: 9, type: 'Constancia laboral', detail: 'Para trámite de crédito Infonavit' },
  ]
  for (const r of pendingRequests) {
    await client.query(
      `INSERT INTO requests (tenant_id, employee_id, type, detail, stage, manager_name)
       VALUES ($1,$2,$3,$4,'MANAGER',$5)`,
      [TENANT_ID, employeeIds[r.employeeIdx], r.type, r.detail, 'Jefe de línea']
    )
  }
  log('✅', `${pendingRequests.length} solicitudes pendientes insertadas`)

  // ── 2 cursos con quiz ────────────────────────────────────────
  const courses = [
    {
      title: 'Manejo Higiénico de Alimentos',
      category: 'Inocuidad',
      description: 'Curso obligatorio de buenas prácticas de manufactura e higiene en planta.',
      durationMin: 45,
      isMandatory: true,
      expiresMonths: 12,
      passScore: 80,
      xpReward: 150,
      quizQuestions: JSON.stringify([
        { question: '¿Cada cuánto debe lavarse las manos un operador en el área de producción?', options: ['Solo al llegar a la planta', 'Cada vez que cambie de actividad o tras usar el baño', 'Una vez por turno', 'Nunca, se usan guantes'], correctIndex: 1 },
        { question: '¿Qué temperatura mínima debe alcanzar el agua caliente para lavado de manos?', options: ['20°C', '30°C', '40°C', 'No importa la temperatura'], correctIndex: 2 },
        { question: '¿Qué se debe hacer si un empleado presenta una herida en la mano?', options: ['Seguir trabajando normalmente', 'Cubrirla con guante o dedil y reportarlo a su supervisor', 'Ignorarlo si no sangra', 'Solo lavarla con agua'], correctIndex: 1 },
      ]),
    },
    {
      title: 'Seguridad e Higiene en Planta',
      category: 'Seguridad',
      description: 'Prevención de riesgos laborales y uso correcto de equipo de protección personal (EPP).',
      durationMin: 30,
      isMandatory: true,
      expiresMonths: 12,
      passScore: 70,
      xpReward: 100,
      quizQuestions: JSON.stringify([
        { question: '¿Qué EPP es obligatorio en el área de producción?', options: ['Ninguno', 'Cofia, guantes y calzado antiderrapante', 'Solo cofia', 'Corbata'], correctIndex: 1 },
        { question: '¿Qué hacer al detectar una fuga de gas?', options: ['Ignorarla', 'Reportar de inmediato y evacuar si es necesario', 'Intentar repararla uno mismo', 'Esperar al siguiente turno'], correctIndex: 1 },
      ]),
    },
  ]
  for (const c of courses) {
    await client.query(
      `INSERT INTO courses (tenant_id, title, category, description, duration_min, is_mandatory, expires_months, pass_score, xp_reward, quiz_questions)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
      [TENANT_ID, c.title, c.category, c.description, c.durationMin, c.isMandatory, c.expiresMonths, c.passScore, c.xpReward, c.quizQuestions]
    )
  }
  log('✅', `${courses.length} cursos insertados`)

  // ── 1 mención para el empleado con más XP ────────────────────
  const topEmployee = await client.query(
    `SELECT id, full_name, xp_points FROM employees ORDER BY xp_points DESC LIMIT 1`
  )
  const top = topEmployee.rows[0]
  await client.query(
    `INSERT INTO mentions (tenant_id, employee_id, type, description, awarded_by, awarded_date, xp_bonus)
     VALUES ($1,$2,'Colaborador del mes',$3,'Recursos Humanos', CURRENT_DATE, 100)`,
    [TENANT_ID, top.id, `Reconocimiento a ${top.full_name} por su desempeño y compromiso durante el mes.`]
  )
  log('✅', `Mención insertada para ${top.full_name} (${top.xp_points} XP)`)

  await client.end()

  console.log('\n' + '═'.repeat(55))
  console.log('✅  SEED COMPLETADO — tenant GFP listo con datos demo')
  console.log('═'.repeat(55) + '\n')
}

main().catch(err => {
  console.error('\n❌  Error en el seed:', err.message)
  process.exit(1)
})

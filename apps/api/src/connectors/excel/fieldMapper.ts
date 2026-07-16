// ============================================================
// CÓDICE · Excel connector — field mapper
// Resuelve headers de spreadsheet (con alias, mayúsculas/acentos
// arbitrarios) a los campos canónicos de `employees`.
// ============================================================

export type CanonicalField =
  | 'full_name'
  | 'rfc'
  | 'curp'
  | 'nss'
  | 'daily_salary'
  | 'monthly_salary'
  | 'department'
  | 'position'
  | 'plant'
  | 'shift'
  | 'hire_date'
  | 'contract_type'
  | 'status'
  | 'employee_code'
  | 'bank_name'
  | 'bank_clabe'
  | 'notes'
  // ── Campos de nómina (payroll_records) — ver PAYROLL_FIELDS más abajo ──
  | 'gross_taxable'
  | 'gross_exempt'
  | 'isr'
  | 'imss_employee'
  | 'infonavit'
  | 'other_deductions'
  | 'total_deductions'
  | 'net_pay'
  | 'days_paid'
  | 'payment_date'
  | 'period'
  | 'year'

const ALIASES: Record<CanonicalField, string[]> = {
  full_name:     ['nombre', 'name', 'nombre completo'],
  rfc:           ['rfc'],
  curp:          ['curp'],
  nss:           ['nss', 'num imss', 'seguro social'],
  daily_salary:  ['salario', 'salario diario', 'sal diario', 'sueldo'],
  department:    ['departamento', 'depto', 'area', 'área'],
  position:      ['puesto', 'cargo', 'posicion', 'posición'],
  plant:         ['planta', 'sucursal', 'centro'],
  shift:         ['turno', 'shift'],
  hire_date:     ['fecha ingreso', 'f ingreso', 'ingreso', 'hire date'],
  contract_type: ['contrato', 'tipo contrato'],
  status:        ['status', 'estatus', 'estado'],

  // Alias deliberadamente mínimos (solo el nombre canónico) — headers reales
  // como "CLAVE", "SALARIO_MENSUAL", "BANCO", "CLABE" NO se auto-detectan
  // aquí a propósito: pasan por suggestField() y requieren confirmación
  // explícita del usuario (ver PART 1 del feature, "Sugerido: X").
  monthly_salary: ['monthly_salary'],
  employee_code:  ['employee_code'],
  bank_name:      ['bank_name'],
  bank_clabe:     ['bank_clabe'],
  notes:          ['notes'],

  // ── Nómina — permiten que el mismo Excel genérico (o un export real de
  // Nomipaq Excel) traiga percepciones/deducciones por fila y alimente
  // payroll_records además de employees. Ver excelParser.ts:mapRowValues.
  gross_taxable:    ['percepciones', 'percepciones_totales', 'PERCEPCIO', 'total_percepciones', 'percepciones brutas', 'sueldo bruto'],
  isr:              ['isr', 'i.s.r', 'retencion_isr', 'impuesto_isr', 'ISR'],
  imss_employee:    ['imss', 'cuota_imss', 'seguro_social', 'IMSS'],
  infonavit:        ['infonavit', 'credito_infonavit', 'INFONAVIT'],
  other_deductions: ['otras_deducciones', 'otros_descuentos', 'prestamos'],
  net_pay:          ['neto', 'sueldo_neto', 'importe_neto', 'NETO', 'neto_pagar'],
  total_deductions: ['deducciones', 'total_deducciones', 'DEDUCCIONES'],
  gross_exempt:     ['percepciones_exentas', 'exento'],
  days_paid:        ['dias', 'dias_trabajados', 'DIAS'],
  payment_date:     ['fecha_pago', 'f_pago', 'FECHA_PAGO', 'fecha de pago'],
  period:           ['periodo', 'quincena', 'PERIODO', 'period'],
  year:             ['anio', 'año', 'ANIO', 'year'],
}

/** Campos que pertenecen a payroll_records (vs. employees) — usado por el
 * wizard de conectores para mostrar "Campos detectados: Empleados / Nómina"
 * y por excelParser.ts para saber si una fila trae datos de nómina. */
export const PAYROLL_FIELDS: ReadonlySet<CanonicalField> = new Set([
  'gross_taxable', 'gross_exempt', 'isr', 'imss_employee', 'infonavit',
  'other_deductions', 'total_deductions', 'net_pay', 'days_paid',
  'payment_date', 'period', 'year',
])

const DIACRITICS_RE = new RegExp('[̀-ͯ]', 'g')

function normalize(header: string): string {
  return header
    .normalize('NFD').replace(DIACRITICS_RE, '') // quita acentos
    .toLowerCase()
    .replace(/[_-]/g, ' ') // "FECHA_INGRESO" / "fecha-ingreso" ~ "fecha ingreso"
    .trim()
    .replace(/\s+/g, ' ')
}

// Etiquetas en español para el field mapper del wizard de conectores (Step 3).
export const CANONICAL_FIELD_LABELS: Record<CanonicalField, string> = {
  full_name:     'Nombre completo',
  rfc:           'RFC',
  curp:          'CURP',
  nss:           'NSS (IMSS)',
  daily_salary:  'Salario diario',
  monthly_salary: 'Salario mensual',
  department:    'Departamento',
  position:      'Puesto',
  plant:         'Planta',
  shift:         'Turno',
  hire_date:     'Fecha de ingreso',
  contract_type: 'Tipo de contrato',
  status:        'Estatus',
  employee_code: 'Clave de empleado',
  bank_name:     'Banco',
  bank_clabe:    'CLABE',
  notes:         'Notas',

  gross_taxable:    'Percepciones (gravadas)',
  gross_exempt:     'Percepciones exentas',
  isr:              'ISR',
  imss_employee:    'IMSS (cuota obrera)',
  infonavit:        'INFONAVIT',
  other_deductions: 'Otras deducciones',
  total_deductions: 'Total deducciones',
  net_pay:          'Neto a pagar',
  days_paid:        'Días pagados',
  payment_date:     'Fecha de pago',
  period:           'Período / quincena',
  year:             'Año',
}

const ALIAS_LOOKUP = new Map<string, CanonicalField>()
for (const field of Object.keys(ALIASES) as CanonicalField[]) {
  for (const alias of ALIASES[field]) {
    ALIAS_LOOKUP.set(normalize(alias), field)
  }
}

/**
 * Mapea la fila de headers de una hoja a los campos canónicos reconocidos.
 * Devuelve columnIndex -> CanonicalField. Headers no reconocidos se ignoran.
 * Si un campo ya fue mapeado por un header anterior, los siguientes se ignoran.
 *
 * `overrideMap` (opcional): header de texto exacto -> CanonicalField (o ''
 * para forzar "sin mapear"), capturado en el wizard del Step 3 — tiene
 * prioridad sobre la auto-detección por alias. Ver PART 1/4 del feature de
 * mapeo inteligente: sin esto, lo que el usuario confirma en el mapper
 * nunca llegaba a afectar la importación real (solo la vista previa).
 */
export function mapHeaders(headers: unknown[], overrideMap?: Record<string, string>): Map<number, CanonicalField> {
  const columnMap = new Map<number, CanonicalField>()
  const seen = new Set<CanonicalField>()

  headers.forEach((header, index) => {
    if (header == null || header === '') return
    const label = String(header).trim()

    const override = overrideMap?.[label]
    if (override !== undefined) {
      if (override && !seen.has(override as CanonicalField)) {
        columnMap.set(index, override as CanonicalField)
        seen.add(override as CanonicalField)
      }
      return // override presente (incluso si es '' = forzado sin mapear): no cae a auto-detección
    }

    const field = ALIAS_LOOKUP.get(normalize(label))
    if (field && !seen.has(field)) {
      columnMap.set(index, field)
      seen.add(field)
    }
  })

  return columnMap
}

// ── Sugerencias por similitud (Tier 2) ──────────────────────────
// Para headers que NO matchearon por alias exacto ("Sin mapear"). Combina
// hints curados de nombres reales frecuentes (incluye mapeos que ninguna
// métrica de texto detectaría, ej. "SUPERVISOR" -> notes, un campo que no
// existe como columna dedicada) con similitud de edición como fallback
// genérico para cualquier otro header parecido a un campo canónico.

const SUGGESTION_HINTS: Record<string, CanonicalField> = {
  'clave': 'employee_code', 'no empleado': 'employee_code', 'numero empleado': 'employee_code',
  'num empleado': 'employee_code', 'codigo': 'employee_code', 'codigo empleado': 'employee_code',
  'salario mensual': 'monthly_salary', 'sueldo mensual': 'monthly_salary', 'sal mensual': 'monthly_salary',
  'banco': 'bank_name',
  'clabe': 'bank_clabe', 'cuenta clabe': 'bank_clabe', 'cuenta': 'bank_clabe',
  'supervisor': 'notes', 'jefe directo': 'notes', 'jefe': 'notes', 'observaciones': 'notes',
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = 0; i <= a.length; i++) dp[i][0] = i
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1])
    }
  }
  return dp[a.length][b.length]
}

function textSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  return 1 - levenshtein(a, b) / maxLen
}

export interface FieldSuggestion {
  field:      CanonicalField
  label:      string
  confidence: number // 0-1
}

const SUGGESTION_MIN_CONFIDENCE = 0.6

/** Sugiere el campo canónico más parecido para un header sin match exacto. */
export function suggestField(header: string): FieldSuggestion | null {
  const norm = normalize(header)
  if (!norm) return null

  const hinted = SUGGESTION_HINTS[norm]
  if (hinted) return { field: hinted, label: CANONICAL_FIELD_LABELS[hinted], confidence: 1 }

  let best: { field: CanonicalField; score: number } | null = null
  for (const field of Object.keys(ALIASES) as CanonicalField[]) {
    const candidates = [field.replace(/_/g, ' '), normalize(CANONICAL_FIELD_LABELS[field]), ...ALIASES[field]]
    for (const candidate of candidates) {
      const score = textSimilarity(norm, normalize(candidate))
      if (!best || score > best.score) best = { field, score }
    }
  }

  if (best && best.score >= SUGGESTION_MIN_CONFIDENCE) {
    return { field: best.field, label: CANONICAL_FIELD_LABELS[best.field], confidence: Math.round(best.score * 100) / 100 }
  }
  return null
}

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
  | 'department'
  | 'position'
  | 'plant'
  | 'shift'
  | 'hire_date'
  | 'contract_type'
  | 'status'
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
  department:    'Departamento',
  position:      'Puesto',
  plant:         'Planta',
  shift:         'Turno',
  hire_date:     'Fecha de ingreso',
  contract_type: 'Tipo de contrato',
  status:        'Estatus',

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
 */
export function mapHeaders(headers: unknown[]): Map<number, CanonicalField> {
  const columnMap = new Map<number, CanonicalField>()
  const seen = new Set<CanonicalField>()

  headers.forEach((header, index) => {
    if (header == null || header === '') return
    const field = ALIAS_LOOKUP.get(normalize(String(header)))
    if (field && !seen.has(field)) {
      columnMap.set(index, field)
      seen.add(field)
    }
  })

  return columnMap
}

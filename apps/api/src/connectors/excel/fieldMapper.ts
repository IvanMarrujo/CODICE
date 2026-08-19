// ============================================================
// CÓDICE · Excel connector — field mapper
// Resuelve headers de spreadsheet (con alias, mayúsculas/acentos
// arbitrarios) a los campos canónicos de `employees`.
// ============================================================

export type CanonicalField =
  | 'full_name'
  | 'first_name'
  | 'last_name'
  | 'rfc'
  | 'curp'
  | 'nss'
  | 'daily_salary'
  | 'monthly_salary'
  | 'salary_base_imss'
  | 'seniority_years'
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
  | 'email'
  | 'phone'
  | 'supervisor_name'
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
  full_name: [
    'nombre', 'name', 'nombre completo',
    'NOMBRES', 'APELLIDOS', 'APE_PAT', 'APE_MAT', 'NOM_EMPLEADO', 'NOMBRE_TRABAJADOR',
  ],
  // Columnas YA separadas (first_name/last_name reales de employees, no un
  // "Nombre completo" a partir. 'nombre'/'NOMBRES'/'APELLIDOS' a secas se
  // quedan como alias de full_name arriba — a propósito, para no romper el
  // flujo de tenants existentes (GFP, etc.) que traen el nombre completo en
  // una sola columna con ese título. Ver mapRowValues en excelParser.ts:
  // si first_name Y last_name llegan mapeados, se usan directo (sin pasar
  // por splitFullName) y tienen prioridad sobre un full_name que también
  // venga mapeado en el mismo archivo.
  first_name: [
    'first_name', 'first name', 'firstname', 'nombre de pila', 'given name',
  ],
  last_name: [
    'last_name', 'last name', 'lastname', 'apellido', 'apellido paterno', 'apellido materno', 'surname',
  ],
  rfc: [
    'rfc',
    'R_F_C', 'RFCTRABAJADOR', 'CVE_RFC',
  ],
  curp: [
    'curp',
    'C_U_R_P', 'CURPTRABAJADOR',
  ],
  nss: [
    'nss', 'num imss', 'seguro social',
    // 'IMSS' a secas NO se agrega aquí a propósito: ya es alias de
    // imss_employee (cuota de nómina) más abajo — un header real llamado
    // solo "IMSS" es ambiguo entre "número de afiliación" y "cuota
    // retenida", y como ALIAS_LOOKUP es un mapa 1:1 por string normalizado,
    // agregarlo también aquí pisaría silenciosamente ese alias existente.
    'N_S_S', 'NUM_SEG_SOCIAL', 'NUMSEGSO', 'NO_IMSS',
  ],
  daily_salary: [
    'salario', 'salario diario', 'sal diario', 'sueldo',
    'SD', 'SAL_DIA',
  ],
  salary_base_imss: [
    'salario_base_imss', 'sbc', 'salario_base_cotizacion',
    'base_cotizacion', 'salario_cotizacion', 'sdi',
    'salario_diario_integrado', 'salario_integrado',
    'BASE_IMSS', 'SALARIO_BASE_IMSS', 'SBC', 'SDI',
    'SAL_BASE_COT', 'SALARIO_BASE_COTIZACION', 'SALARIO_DIARIO_INTEGRADO',
    'SAL_INT', 'SUELDO_INTEGRADO', 'BASE_COTIZACION',
    'SAL_DIARIO_INTEGRADO', 'S_D_I',
  ],
  seniority_years: [
    'antiguedad_anios', 'ANTIGUEDAD_ANIOS', 'antiguedad', 'anios_servicio',
    'años_servicio', 'years_of_service', 'antiguedad_anos', 'seniority',
  ],
  department: [
    'departamento', 'depto', 'area', 'área',
    'CVE_DEPTO', 'CENTRO_COSTO', 'DEPART', 'NOM_DEPTO',
    'CVE_CENTRO_COSTO', 'CENTRO_DE_COSTO', 'COST_CENTER', 'CC',
  ],
  position: [
    'puesto', 'cargo', 'posicion', 'posición',
    'CVE_PUESTO', 'NOM_PUESTO', 'OCUPACION', 'CATEGORIA', 'PLAZA',
  ],
  plant: [
    'planta', 'sucursal', 'centro',
    'CVE_SUCURSAL', 'CENTRO_TRABAJO', 'UBICACION', 'LOCALIDAD',
  ],
  shift: [
    'turno', 'shift',
    'CVE_TURNO', 'JORNADA', 'HORARIO',
    'TIPO_JORNADA', 'JORNADA_LABORAL', 'HORAS_JORNADA',
  ],
  hire_date: [
    'fecha ingreso', 'f ingreso', 'ingreso', 'hire date',
    'FECHA_INGRESO', 'FEC_INGRESO', 'FINGRESO', 'FECHA_ALTA', 'FEC_ALTA',
    'FECHA_CONTRATACION', 'FCONTRAT', 'F_INGRESO',
    'F_ALTA', 'FECHA_DE_ALTA', 'ALTA_IMSS', 'FECHA_INGRESO_IMSS',
  ],
  contract_type: [
    'contrato', 'tipo contrato',
    'TIPO_RELACION', 'MODALIDAD', 'CVE_CONTRATO', 'TIPO_EMPLEADO',
  ],
  status: [
    'status', 'estatus', 'estado',
    'CVE_STATUS', 'SITUACION', 'ACTIVO', 'BAJA',
  ],

  // Alias deliberadamente mínimos (solo el nombre canónico) — headers reales
  // como "CLAVE", "SALARIO_MENSUAL", "BANCO", "CLABE" NO se auto-detectan
  // aquí a propósito: pasan por suggestField() y requieren confirmación
  // explícita del usuario (ver PART 1 del feature, "Sugerido: X").
  // ── (Actualización: los headers reales de Nomipaq/CONTPAQi de abajo SÍ se
  // agregan como alias exactos — ver ADDITIONAL del feature de aliases
  // reales — y los hints ahora redundantes se quitaron de SUGGESTION_HINTS.)
  monthly_salary: [
    'monthly_salary',
    'SALARIO_MENSUAL', 'SAL_MENSUAL', 'SUELDO_MENSUAL', 'SM', 'SAL_MES',
  ],
  employee_code: [
    'employee_code',
    'CLAVE', 'CVE_EMPLEADO', 'NO_EMPLEADO', 'NUM_EMP', 'CVEMP', 'NUMEMPLEADO', 'ID_EMPLEADO',
  ],
  bank_name: [
    'bank_name',
    'BANCO', 'CVE_BANCO', 'NOM_BANCO', 'INSTITUCION',
  ],
  bank_clabe: [
    'bank_clabe',
    'CLABE', 'CUENTA_CLABE', 'NUM_CUENTA', 'CUENTA_BANCARIA', 'CLABE_INTERBANCARIA',
  ],
  notes: ['notes'],
  email: [
    'email', 'correo', 'correo electronico', 'e-mail', 'e mail',
    'EMAIL', 'CORREO', 'CORREO_ELECTRONICO',
  ],
  phone: [
    'telefono', 'teléfono', 'celular', 'phone', 'mobile',
    'TELEFONO', 'CELULAR', 'TEL', 'NUM_CEL',
  ],
  supervisor_name: [
    'supervisor', 'jefe directo', 'jefe inmediato', 'reporta a',
    'SUPERVISOR', 'JEFE_DIRECTO', 'JEFE_INMEDIATO', 'REPORTA_A',
  ],

  // ── Nómina — permiten que el mismo Excel genérico (o un export real de
  // Nomipaq Excel) traiga percepciones/deducciones por fila y alimente
  // payroll_records además de employees. Ver excelParser.ts:mapRowValues.
  gross_taxable: [
    'percepciones', 'percepciones_totales', 'PERCEPCIO', 'total_percepciones', 'percepciones brutas', 'sueldo bruto',
    'TOTAL_PERCEPCIONES', 'PERC_GRAV', 'GRAVADO', 'TOTAL_GRAVADO', 'IMPORTE_GRAVADO',
  ],
  isr: [
    'isr', 'i.s.r', 'retencion_isr', 'impuesto_isr', 'ISR',
    'DESC_ISR', 'DEDUCCION_ISR', 'RET_ISR',
  ],
  imss_employee: [
    'imss', 'cuota_imss', 'seguro_social', 'IMSS',
    'CUOTA_IMSS', 'DESC_IMSS', 'CUOTA_OBRERA', 'DEDUCCION_IMSS', 'RET_IMSS',
  ],
  infonavit: [
    'infonavit', 'credito_infonavit', 'INFONAVIT',
    'DESC_INFONAVIT', 'CREDITO_INFONAVIT', 'DEDUCCION_INFONAVIT', 'RET_INFONAVIT', 'INFO',
  ],
  other_deductions: [
    'otras_deducciones', 'otros_descuentos', 'prestamos',
    'OTRAS_DEDUCCIONES', 'OTROS_DESCUENTOS', 'DEDUCCIONES_OTRAS', 'PRESTAMOS', 'CAJA_AHORRO', 'DESCUENTOS', 'OTROS',
  ],
  net_pay: [
    'neto', 'sueldo_neto', 'importe_neto', 'NETO', 'neto_pagar',
    'SUELDO_NETO', 'IMPORTE_NETO', 'NETO_PAGAR', 'TOTAL_NETO', 'PAGO_NETO', 'LIQUIDO', 'IMPORTE_PAGO',
  ],
  total_deductions: [
    'deducciones', 'total_deducciones', 'DEDUCCIONES',
    'TOTAL_DEDUCCIONES', 'TOTAL_DESCUENTOS', 'DEDUCCION_TOTAL', 'DESC_TOTAL',
  ],
  gross_exempt: [
    'percepciones_exentas', 'exento',
    'PERCEPCIONES_EXENTAS', 'PERC_EXEN', 'EXENTO', 'TOTAL_EXENTO', 'IMPORTE_EXENTO',
  ],
  days_paid: [
    'dias', 'dias_trabajados', 'DIAS',
    'DIAS_PAGADOS', 'NUM_DIAS', 'PERIODO_DIAS', 'DIAS_PERIODO',
  ],
  payment_date: [
    'fecha_pago', 'f_pago', 'FECHA_PAGO', 'fecha de pago',
    'FEC_PAGO', 'FECHA_DEPOSITO', 'FEC_DEPOSITO',
  ],
  period: [
    'periodo', 'quincena', 'PERIODO', 'period',
    'SEMANA', 'CVE_PERIODO', 'NUM_PERIODO', 'PERIODO_PAGO', 'EJERCICIO_PERIODO',
  ],
  year: [
    'anio', 'año', 'ANIO', 'year',
    'EJERCICIO', 'CVE_ANIO',
  ],
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
  first_name:    'Nombre(s)',
  last_name:     'Apellido(s)',
  rfc:           'RFC',
  curp:          'CURP',
  nss:           'NSS (IMSS)',
  daily_salary:  'Salario diario',
  monthly_salary: 'Salario mensual',
  salary_base_imss: 'SBC (Base Cotización IMSS)',
  seniority_years: 'Antigüedad declarada (años)',
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
  email:         'Correo electrónico',
  phone:         'Teléfono',
  supervisor_name: 'Supervisor',

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

// Sentinel usado por el wizard (Step 3, "Crear campo personalizado") para
// marcar una columna como destino de un campo ad-hoc en lugar de un
// CanonicalField fijo — ej. overrideMap["Supervisor Directo"] =
// "__custom__:Supervisor Directo". El valor tras el prefijo es la etiqueta
// que el usuario eligió, y se guarda tal cual como llave en
// employees.custom_fields (ver CustomFieldMatch más abajo y mapRowValues en
// excelParser.ts). Mismo prefijo que CUSTOM_FIELD_PREFIX en App.jsx.
export const CUSTOM_FIELD_PREFIX = '__custom__:'

export interface CustomFieldMatch {
  index: number
  label: string // etiqueta elegida por el usuario para employees.custom_fields
}

export interface HeaderMapResult {
  fields: Map<number, CanonicalField>
  custom: CustomFieldMatch[]
}

/**
 * Mapea la fila de headers de una hoja a los campos canónicos reconocidos
 * (+ columnas marcadas como campo personalizado). Headers no reconocidos se
 * ignoran. Si un campo ya fue mapeado por un header anterior, los siguientes
 * se ignoran.
 *
 * `overrideMap` (opcional): header de texto exacto -> CanonicalField, ''
 * (forzar "sin mapear") o `__custom__:{label}` (campo personalizado),
 * capturado en el wizard del Step 3 — tiene prioridad sobre la
 * auto-detección por alias. Ver PART 1/4 del feature de mapeo inteligente:
 * sin esto, lo que el usuario confirma en el mapper nunca llegaba a afectar
 * la importación real (solo la vista previa).
 */
export function mapHeaders(headers: unknown[], overrideMap?: Record<string, string>): HeaderMapResult {
  const fields = new Map<number, CanonicalField>()
  const custom: CustomFieldMatch[] = []
  const seen = new Set<CanonicalField>()

  headers.forEach((header, index) => {
    if (header == null || header === '') return
    const label = String(header).trim()

    const override = overrideMap?.[label]
    if (override !== undefined) {
      if (override.startsWith(CUSTOM_FIELD_PREFIX)) {
        const customLabel = override.slice(CUSTOM_FIELD_PREFIX.length).trim()
        if (customLabel) custom.push({ index, label: customLabel })
        return
      }
      if (override && !seen.has(override as CanonicalField)) {
        fields.set(index, override as CanonicalField)
        seen.add(override as CanonicalField)
      }
      return // override presente (incluso si es '' = forzado sin mapear): no cae a auto-detección
    }

    const field = ALIAS_LOOKUP.get(normalize(label))
    if (field && !seen.has(field)) {
      fields.set(index, field)
      seen.add(field)
    }
  })

  return { fields, custom }
}

// ── Sugerencias por similitud (Tier 2) ──────────────────────────
// Para headers que NO matchearon por alias exacto ("Sin mapear"). Combina
// hints curados de nombres reales frecuentes con similitud de edición como
// fallback genérico para cualquier otro header parecido a un campo canónico.
//
// 'clave', 'no empleado', 'salario mensual', 'sueldo mensual', 'sal
// mensual', 'banco', 'clabe', 'cuenta clabe', 'supervisor' y 'jefe directo'
// se quitaron de aquí: ahora son alias exactos (ver ALIASES arriba) —
// dejarlos aquí los habría vuelto inalcanzables (mapHeaders siempre revisa
// ALIASES antes que suggestField).

const SUGGESTION_HINTS: Record<string, CanonicalField> = {
  'numero empleado': 'employee_code', 'codigo': 'employee_code', 'codigo empleado': 'employee_code',
  'cuenta': 'bank_clabe',
  'jefe': 'supervisor_name', 'observaciones': 'notes',
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

function tokenize(s: string): string[] {
  return s.split(' ').filter(Boolean)
}

// Similitud char-a-char sola se deja engañar por una palabra genérica
// compartida entre frases de 2+ palabras — ej. "last name" vs "bank name"
// daba 0.67 de similitud (comparten " name", que es más de la mitad de la
// cadena) aunque "last" y "bank" no tengan relación. Confirmado con datos
// reales: sugería mapear una columna de apellido a "Banco" con 67% de
// confianza. Para frases multi-palabra en ambos lados, el score real es el
// mínimo entre similitud de texto completo y solapamiento de tokens
// (Jaccard) — así una sola palabra en común entre frases largas ya no
// domina. Comparaciones de una sola palabra (la mayoría de los headers
// reales) no se tocan, siguen igual que antes.
function textSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length)
  const charSim = maxLen === 0 ? 1 : 1 - levenshtein(a, b) / maxLen

  const tokensA = tokenize(a)
  const tokensB = tokenize(b)
  if (tokensA.length > 1 && tokensB.length > 1) {
    const setA = new Set(tokensA)
    const setB = new Set(tokensB)
    const intersection = [...setA].filter((t) => setB.has(t)).length
    const union = new Set([...setA, ...setB]).size
    const tokenSim = union === 0 ? 1 : intersection / union
    return Math.min(charSim, tokenSim)
  }

  return charSim
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

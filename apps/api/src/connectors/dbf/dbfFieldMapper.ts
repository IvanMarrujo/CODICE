// ============================================================
// CÓDICE · NOMIPAQ connector — field mapper
// Resuelve nombres de campo DBF (ALL CAPS, <=10 chars, muy
// abreviados y sin estándar fijo entre instalaciones) a los
// campos canónicos de employees / payroll_records.
// ============================================================

export type DbfCanonicalField =
  | 'employee_code' | 'first_name' | 'apellido_paterno' | 'apellido_materno'
  | 'rfc' | 'curp' | 'nss' | 'daily_salary' | 'department' | 'position'
  | 'plant' | 'shift' | 'hire_date' | 'contract_type' | 'status'
  | 'folio' | 'payment_date' | 'period_start' | 'period_end' | 'days_paid'
  | 'total_income' | 'total_deductions' | 'net_pay' | 'isr' | 'imss_employee'

const ALIASES: Record<DbfCanonicalField, string[]> = {
  employee_code:    ['CVE_EMP', 'CVEEMP', 'CLAVE', 'NUM_EMP', 'NUMEMP', 'CVE', 'EMPLEADO'],
  first_name:       ['NOMBRE', 'NOMBRES'],
  apellido_paterno: ['PATERNO', 'APPAT', 'APELLIDO1', 'AP_PAT'],
  apellido_materno: ['MATERNO', 'APMAT', 'APELLIDO2', 'AP_MAT'],
  rfc:              ['RFC'],
  curp:             ['CURP'],
  nss:              ['NSS', 'SEGSOC', 'SEG_SOC'],
  daily_salary:     ['SDIARIO', 'SUELDO_D', 'SALARIO', 'SDO_DIA', 'SBC'],
  department:       ['DEPARTAM', 'DEPTO', 'AREA'],
  position:         ['PUESTO', 'CARGO'],
  plant:            ['PLANTA', 'SUCURSAL', 'CENTRO'],
  shift:            ['TURNO'],
  hire_date:        ['F_INGRESO', 'FINGRESO', 'FECHA_ING', 'FEC_ING'],
  contract_type:    ['CONTRATO', 'TIPOCONT'],
  status:           ['STATUS', 'ESTATUS', 'ACTIVO'],
  folio:            ['FOLIO', 'NUM_REC'],
  payment_date:     ['F_PAGO', 'FECHAPAGO', 'FEC_PAGO'],
  period_start:     ['PER_INI', 'PERIODOINI', 'FEC_INI'],
  period_end:       ['PER_FIN', 'PERIODOFIN', 'FEC_FIN'],
  days_paid:        ['DIAS', 'DIAS_PAG'],
  total_income:     ['PERCEPCION', 'TOTAL_PER', 'PERCEP'],
  total_deductions: ['DEDUCCION', 'TOTAL_DED', 'DEDUC'],
  net_pay:          ['NETO', 'TOTAL_NETO', 'NETO_PAGAR'],
  isr:              ['ISR'],
  imss_employee:    ['IMSS'],
}

function normalize(name: string): string {
  return name.trim().toUpperCase()
}

const ALIAS_LOOKUP = new Map<string, DbfCanonicalField>()
for (const field of Object.keys(ALIASES) as DbfCanonicalField[]) {
  for (const alias of ALIASES[field]) ALIAS_LOOKUP.set(normalize(alias), field)
}

/** Mapea nombreDeCampoDBF -> campo canónico. Ignora campos no reconocidos. */
export function mapDbfHeaders(fieldNames: string[]): Map<string, DbfCanonicalField> {
  const map = new Map<string, DbfCanonicalField>()
  const seen = new Set<DbfCanonicalField>()
  for (const name of fieldNames) {
    const canonical = ALIAS_LOOKUP.get(normalize(name))
    if (canonical && !seen.has(canonical)) {
      map.set(name, canonical)
      seen.add(canonical)
    }
  }
  return map
}

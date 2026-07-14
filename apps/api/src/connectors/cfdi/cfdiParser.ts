// ============================================================
// CÓDICE · CONTPAQ connector — parser CFDI Nómina 1.2
// Parseo puro: buffer XML (CFDI + complemento nomina12) -> fila
// canónica de employee + payroll. Sin acceso a DB ni efectos
// secundarios. Nunca lanza — errores se devuelven en `error`.
// ============================================================

import { parseStringPromise } from 'xml2js'
import { EmployeeUpsertRow, PayrollUpsertRow } from '../common'
import { splitFullName } from '../excel/excelParser'

export interface ParsedCfdi {
  employee?: EmployeeUpsertRow
  payroll?:  PayrollUpsertRow
  error?:    string
}

// SAT catálogo c_TipoContrato -> tipos usados en `employees.contract_type`
const TIPO_CONTRATO: Record<string, string> = {
  '01': 'Indeterminado',
  '02': 'Obra/Proyecto',
  '03': 'Determinado',
  '04': 'Determinado',
  '05': 'Periodo de prueba',
  '06': 'Capacitación inicial',
}

// SAT catálogo c_PeriodicidadPago -> `payroll_records.payroll_type`
const PERIODICIDAD: Record<string, string> = {
  '01': 'Semanal', '02': 'Semanal', '03': 'Quincenal', '04': 'Quincenal', '05': 'Mensual',
}

function localName(tag: string): string {
  const idx = tag.indexOf(':')
  return idx === -1 ? tag : tag.slice(idx + 1)
}

/** Busca el primer hijo directo cuyo nombre local (sin prefijo de namespace) coincida. */
function findChild(node: any, name: string): any {
  if (node == null || typeof node !== 'object') return undefined
  for (const key of Object.keys(node)) {
    if (key === '$') continue
    if (localName(key) === name) return node[key]
  }
  return undefined
}

/** Busca recursivamente en todo el árbol (para tolerar prefijos de namespace variables). */
function findDescendant(node: any, name: string): any {
  const direct = findChild(node, name)
  if (direct !== undefined) return direct
  if (node == null || typeof node !== 'object') return undefined
  for (const key of Object.keys(node)) {
    if (key === '$') continue
    const child = Array.isArray(node[key]) ? node[key][0] : node[key]
    const found = findDescendant(child, name)
    if (found !== undefined) return found
  }
  return undefined
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return []
  return Array.isArray(v) ? v : [v]
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function dateOrUndefined(v: unknown): Date | undefined {
  if (!v) return undefined
  const d = new Date(String(v))
  return isNaN(d.getTime()) ? undefined : d
}

export async function parseCfdiBuffer(buffer: Buffer, filename: string): Promise<ParsedCfdi> {
  let doc: any
  try {
    doc = await parseStringPromise(buffer.toString('utf-8'), { explicitArray: false, mergeAttrs: false, trim: true })
  } catch (err: any) {
    return { error: `No se pudo leer "${filename}": ${err.message}` }
  }

  const comprobante = findChild(doc, 'Comprobante')
  if (!comprobante) return { error: `"${filename}" no es un CFDI válido (no se encontró cfdi:Comprobante)` }

  const nomina = findDescendant(comprobante, 'Nomina')
  if (!nomina) return { error: `"${filename}" no contiene el complemento de nómina (nomina12:Nomina)` }

  const cfdiReceptor  = findChild(comprobante, 'Receptor')?.$ || {}
  const nominaReceptor = findChild(nomina, 'Receptor')?.$ || {}
  const percepciones  = findChild(nomina, 'Percepciones')
  const deducciones   = findChild(nomina, 'Deducciones')
  const timbre        = findDescendant(comprobante, 'TimbreFiscalDigital')?.$ || {}
  const nominaAttrs    = nomina.$ || {}
  const comprobanteAttrs = comprobante.$ || {}

  if (!cfdiReceptor.Nombre) return { error: `"${filename}": falta el nombre del receptor` }

  const { first_name, last_name } = splitFullName(String(cfdiReceptor.Nombre))

  const employee: EmployeeUpsertRow = {
    first_name,
    last_name,
    rfc:           cfdiReceptor.Rfc ? String(cfdiReceptor.Rfc).toUpperCase() : undefined,
    curp:          nominaReceptor.Curp ? String(nominaReceptor.Curp).toUpperCase() : undefined,
    nss:           nominaReceptor.NumSeguridadSocial,
    employee_code: nominaReceptor.NumEmpleado,
    department:    nominaReceptor.Departamento,
    position:      nominaReceptor.Puesto,
    hire_date:     dateOrUndefined(nominaReceptor.FechaInicioRelLaboral),
    contract_type: nominaReceptor.TipoContrato ? TIPO_CONTRATO[nominaReceptor.TipoContrato] : undefined,
    daily_salary:  nominaReceptor.SalarioDiarioIntegrado != null ? num(nominaReceptor.SalarioDiarioIntegrado)
                  : nominaReceptor.SalarioBaseCotApor != null ? num(nominaReceptor.SalarioBaseCotApor)
                  : undefined,
  }

  if (!employee.rfc) return { error: `"${filename}": falta el RFC del receptor` }

  const deduccionRows = asArray(findChild(deducciones, 'Deduccion')).map((d: any) => d.$ || {})
  const sumByClave = (claves: string[], keywordRe: RegExp) =>
    deduccionRows
      .filter((d) => claves.includes(d.Clave) || claves.includes(d.TipoDeduccion) || keywordRe.test(String(d.Concepto || '')))
      .reduce((acc, d) => acc + num(d.Importe), 0)

  const isr           = sumByClave(['002'], /\bisr\b/i)
  const imssEmployee   = sumByClave(['004'], /\bimss\b/i)
  const infonavit      = sumByClave(['006'], /infonavit/i)
  const totalDeductions = num(nominaAttrs.TotalDeducciones)
  const otherDeductions = Math.max(0, totalDeductions - isr - imssEmployee - infonavit)

  const grossTaxable = num(percepciones?.$?.TotalGravado)
  const grossExempt  = num(percepciones?.$?.TotalExento)
  const totalIncome  = nominaAttrs.TotalPercepciones != null ? num(nominaAttrs.TotalPercepciones) : grossTaxable + grossExempt

  const payroll: PayrollUpsertRow = {
    folio:            comprobanteAttrs.Folio,
    uuid_sat:         timbre.UUID,
    payroll_type:     nominaReceptor.PeriodicidadPago ? PERIODICIDAD[nominaReceptor.PeriodicidadPago] || 'Quincenal' : 'Quincenal',
    period_start:     dateOrUndefined(nominaAttrs.FechaInicialPago),
    period_end:       dateOrUndefined(nominaAttrs.FechaFinalPago),
    payment_date:     dateOrUndefined(nominaAttrs.FechaPago) || dateOrUndefined(comprobanteAttrs.Fecha),
    days_paid:        num(nominaAttrs.NumDiasPagados),
    gross_taxable:    grossTaxable,
    gross_exempt:     grossExempt,
    total_income:     totalIncome,
    isr,
    imss_employee:    imssEmployee,
    infonavit,
    other_deductions: otherDeductions,
    total_deductions: totalDeductions,
    net_pay:          totalIncome - totalDeductions + num(nominaAttrs.TotalOtrosPagos),
  }

  return { employee, payroll }
}

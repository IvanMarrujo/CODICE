// ============================================================
// CÓDICE · Excel connector — parser
// Parseo puro: buffer (.xlsx/.csv) -> filas mapeadas a los campos
// canónicos de `employees`. Sin acceso a DB ni efectos secundarios.
// ============================================================

import * as XLSX from 'xlsx'
import { mapHeaders, suggestField, CanonicalField, PAYROLL_FIELDS, FieldSuggestion } from './fieldMapper'

// Campos de payroll_records que una fila de Excel puede traer además de los
// datos del empleado — ver mapRowValues(). `period` no es una columna real
// de payroll_records: se combina con `year` en `period_label`, que junto con
// `payment_date` es la llave de upsert para archivos sin folio/UUID fiscal
// (ver upsertPayrollRecord en routes/connectors.ts).
export interface ParsedPayrollFields {
  gross_taxable?:     number
  gross_exempt?:      number
  total_income?:      number
  isr?:               number
  imss_employee?:     number
  infonavit?:         number
  other_deductions?:  number
  total_deductions?:  number
  net_pay?:           number
  days_paid?:         number
  payment_date?:      Date
  period_label?:      string
}

export interface ParsedEmployeeRow {
  row:             number   // número de fila en la hoja (1-based, incluye header)
  first_name?:     string
  last_name?:      string
  rfc?:            string
  curp?:           string
  nss?:            string
  daily_salary?:   number
  monthly_salary?: number
  department?:     string
  position?:       string
  plant?:          string
  shift?:          string
  hire_date?:      Date
  contract_type?:  string
  status?:         string
  employee_code?:  string
  bank_name?:      string
  bank_clabe?:     string
  notes?:          string
  payroll?:        ParsedPayrollFields  // presente solo si la fila trae columnas de nómina
}

export interface RowError {
  row:     number
  message: string
}

export interface ParseResult {
  rows:   ParsedEmployeeRow[]
  errors: RowError[]
}

/** Parsea un buffer .xlsx/.csv y devuelve filas mapeadas + errores por fila. Nunca lanza.
 * `overrideMap` (opcional): mapeo header de texto -> CanonicalField confirmado
 * por el usuario en el Step 3 del wizard — tiene prioridad sobre la
 * auto-detección por alias (ver mapHeaders en fieldMapper.ts). */
export function parseExcelBuffer(buffer: Buffer, filename: string, overrideMap?: Record<string, string>): ParseResult {
  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  } catch (err: any) {
    return { rows: [], errors: [{ row: 0, message: `No se pudo leer "${filename}": ${err.message}` }] }
  }

  const sheetName = workbook.SheetNames[0]
  if (!sheetName) {
    return { rows: [], errors: [{ row: 0, message: `"${filename}" no contiene hojas` }] }
  }

  const sheet = workbook.Sheets[sheetName]
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' })
  if (raw.length === 0) return { rows: [], errors: [] }

  const headerRow = raw[0] || []
  const columnMap = mapHeaders(headerRow, overrideMap)
  if (columnMap.size === 0) {
    return { rows: [], errors: [{ row: 1, message: `"${filename}": no se reconoció ninguna columna en el encabezado` }] }
  }

  const rows: ParsedEmployeeRow[] = []
  const errors: RowError[] = []

  for (let i = 1; i < raw.length; i++) {
    const cells = raw[i]
    const rowNumber = i + 1
    if (!cells || cells.every(c => c === '' || c == null)) continue // fila vacía

    const values: Partial<Record<CanonicalField, unknown>> = {}
    for (const [colIndex, field] of columnMap.entries()) {
      const cell = cells[colIndex]
      if (cell !== undefined && cell !== null && String(cell).trim() !== '') {
        values[field] = cell
      }
    }
    if (Object.keys(values).length === 0) continue

    try {
      rows.push(mapRowValues(values, rowNumber))
    } catch (err: any) {
      errors.push({ row: rowNumber, message: err.message })
    }
  }

  return { rows, errors }
}

export interface HeaderMatch {
  index:      number
  label:      string
  field:      CanonicalField | null
  suggestion: FieldSuggestion | null // solo presente cuando field === null
}

export interface PreviewResult {
  headers: HeaderMatch[]
  preview: ParsedEmployeeRow[]
  totalRows: number
  errors: RowError[]
}

/**
 * Como parseExcelBuffer pero además devuelve el detalle de mapeo de columnas
 * (para el wizard de conectores — Step 3, "field mapper") y solo las
 * primeras `maxPreviewRows` filas ya parseadas. Sin efectos secundarios.
 * `overrideMap`: ver parseExcelBuffer — mapeo guardado del tenant o
 * confirmado a mano, tiene prioridad sobre la auto-detección.
 */
export function previewExcelBuffer(buffer: Buffer, filename: string, maxPreviewRows = 5, overrideMap?: Record<string, string>): PreviewResult {
  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  } catch (err: any) {
    return { headers: [], preview: [], totalRows: 0, errors: [{ row: 0, message: `No se pudo leer "${filename}": ${err.message}` }] }
  }

  const sheetName = workbook.SheetNames[0]
  if (!sheetName) {
    return { headers: [], preview: [], totalRows: 0, errors: [{ row: 0, message: `"${filename}" no contiene hojas` }] }
  }

  const sheet = workbook.Sheets[sheetName]
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' })
  const headerRow = raw[0] || []
  const columnMap = mapHeaders(headerRow, overrideMap)

  const headers: HeaderMatch[] = headerRow
    .map((h, index) => {
      const label = String(h ?? '').trim()
      const field = columnMap.get(index) ?? null
      return { index, label, field, suggestion: field ? null : (label ? suggestField(label) : null) }
    })
    .filter((h) => h.label !== '')

  const { rows, errors } = parseExcelBuffer(buffer, filename, overrideMap)
  return { headers, preview: rows.slice(0, maxPreviewRows), totalRows: rows.length, errors }
}

function mapRowValues(values: Partial<Record<CanonicalField, unknown>>, rowNumber: number): ParsedEmployeeRow {
  const out: ParsedEmployeeRow = { row: rowNumber }

  if (values.full_name != null) {
    const { first_name, last_name } = splitFullName(String(values.full_name))
    out.first_name = first_name
    out.last_name  = last_name
  }

  if (values.rfc != null)  out.rfc  = String(values.rfc).trim().toUpperCase()
  if (values.curp != null) out.curp = String(values.curp).trim().toUpperCase()
  if (values.nss != null)  out.nss  = String(values.nss).trim()

  if (values.daily_salary != null) {
    const n = parseSalary(values.daily_salary)
    if (n === null) throw new Error(`Salario inválido: "${values.daily_salary}"`)
    out.daily_salary = n
  }
  if (values.monthly_salary != null) {
    const n = parseSalary(values.monthly_salary)
    if (n === null) throw new Error(`Salario mensual inválido: "${values.monthly_salary}"`)
    out.monthly_salary = n
  }

  if (values.department != null)    out.department    = String(values.department).trim()
  if (values.position != null)      out.position      = String(values.position).trim()
  if (values.plant != null)         out.plant         = String(values.plant).trim()
  if (values.shift != null)         out.shift         = String(values.shift).trim()
  if (values.contract_type != null) out.contract_type = String(values.contract_type).trim()
  if (values.status != null)        out.status        = String(values.status).trim()
  if (values.employee_code != null) out.employee_code = String(values.employee_code).trim()
  if (values.bank_name != null)     out.bank_name     = String(values.bank_name).trim()
  if (values.bank_clabe != null)    out.bank_clabe    = String(values.bank_clabe).trim()
  if (values.notes != null)         out.notes         = String(values.notes).trim()

  if (values.hire_date != null) {
    const d = parseDate(values.hire_date)
    if (d === null) throw new Error(`Fecha de ingreso inválida: "${values.hire_date}"`)
    out.hire_date = d
  }

  if (!out.first_name || !out.last_name) {
    throw new Error('Falta nombre completo (nombre y apellido)')
  }

  const payroll = mapPayrollValues(values)
  if (payroll) out.payroll = payroll

  return out
}

/**
 * Si la fila trae CUALQUIER columna de nómina (percepciones, ISR, IMSS,
 * INFONAVIT, neto, período…), arma el objeto de payroll_records para esa
 * fila — así el mismo Excel genérico sirve tanto para archivos de solo
 * plantilla (turnos, departamentos) como para archivos completos de nómina
 * (nomina_gfp_mock.xlsx, exports reales de Nomipaq Excel).
 */
function mapPayrollValues(values: Partial<Record<CanonicalField, unknown>>): ParsedPayrollFields | undefined {
  const hasPayrollField = Array.from(PAYROLL_FIELDS).some((f) => values[f] != null)
  if (!hasPayrollField) return undefined

  const amount = (field: CanonicalField): number => {
    const raw = values[field]
    if (raw == null) return 0
    const n = parseSalary(raw)
    if (n === null) throw new Error(`Monto inválido en "${field}": "${raw}"`)
    return n
  }

  const gross_taxable = amount('gross_taxable')
  const gross_exempt  = amount('gross_exempt')
  const isr             = amount('isr')
  const imss_employee   = amount('imss_employee')
  const infonavit        = amount('infonavit')
  const other_deductions = amount('other_deductions')

  // total_deductions: si el archivo ya trae un total (columna "DEDUCCIONES"),
  // se respeta tal cual — algunos exports solo dan el lump sum, sin desglose.
  // Si no, se calcula a partir del desglose disponible.
  const total_deductions = values.total_deductions != null
    ? amount('total_deductions')
    : isr + imss_employee + infonavit + other_deductions

  const total_income = gross_taxable + gross_exempt

  const net_pay = values.net_pay != null ? amount('net_pay') : total_income - total_deductions

  const payroll: ParsedPayrollFields = {
    gross_taxable, gross_exempt, total_income,
    isr, imss_employee, infonavit, other_deductions, total_deductions,
    net_pay,
  }

  if (values.days_paid != null) {
    const n = parseSalary(values.days_paid)
    if (n === null) throw new Error(`Días pagados inválido: "${values.days_paid}"`)
    payroll.days_paid = n
  }

  if (values.payment_date != null) {
    const d = parseDate(values.payment_date)
    if (d === null) throw new Error(`Fecha de pago inválida: "${values.payment_date}"`)
    payroll.payment_date = d
  }

  const periodLabel = buildPeriodLabel(values.period, values.year)
  if (periodLabel) payroll.period_label = periodLabel

  return payroll
}

/** Combina "período" + "año" en una sola etiqueta usada como llave de upsert
 * (junto con payment_date) para recibos que no traen folio/UUID fiscal —
 * ver el comentario en upsertPayrollRecord (routes/connectors.ts). */
function buildPeriodLabel(period: unknown, year: unknown): string | undefined {
  if (period == null) return undefined
  const p = String(period).trim()
  if (!p) return undefined
  const y = year != null ? String(year).trim() : ''
  if (y && !p.includes(y)) return `${p} ${y}`
  return p
}

/** Divide "Juan Carlos Pérez López" en first_name="Juan Carlos Pérez" / last_name="López" (último espacio). */
export function splitFullName(fullName: string): { first_name: string; last_name: string } {
  const clean = fullName.trim().replace(/\s+/g, ' ')
  const lastSpace = clean.lastIndexOf(' ')
  if (lastSpace === -1) return { first_name: clean, last_name: '' }
  return {
    first_name: clean.slice(0, lastSpace),
    last_name:  clean.slice(lastSpace + 1),
  }
}

function parseSalary(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  const cleaned = String(raw).replace(/[^0-9.,-]/g, '').replace(/,/g, '')
  if (cleaned === '') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

function parseDate(raw: unknown): Date | null {
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw

  const str = String(raw).trim()

  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) {
    const d = new Date(str)
    return isNaN(d.getTime()) ? null : d
  }

  const dmy = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (dmy) {
    const [, dd, mm, yyyy] = dmy
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd))
    return isNaN(d.getTime()) ? null : d
  }

  const d = new Date(str)
  return isNaN(d.getTime()) ? null : d
}

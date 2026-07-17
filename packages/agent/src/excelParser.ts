// ============================================================
// CÓDICE Agent · excelParser — lee el Excel vigilado a filas
// canónicas (mismos nombres de columna que WRITABLE_EMPLOYEE_COLUMNS /
// WRITABLE_PAYROLL_COLUMNS en apps/api/src/routes/connectors.ts) para
// que diffEngine pueda comparar campo por campo y watcher pueda mandar
// el delta ya separado por entidad.
//
// A propósito NO replica el field-mapper con memoria del backend
// (apps/api/src/connectors/excel/fieldMapper.ts) — el agente corre
// fuera del monorepo de la app y su única fuente es el Excel genérico
// de nómina (mismas columnas que crea simulate.ts): nombre, rfc,
// PERCEPCIONES, ISR, IMSS, INFONAVIT, PERIODO, FECHA_PAGO.
// ============================================================

import * as XLSX from 'xlsx'

export interface ParsedRow {
  employee_code?: string
  rfc?: string
  first_name?: string
  last_name?: string
  [field: string]: unknown
}

const HEADER_MAP: Record<string, string> = {
  nombre:            '__full_name',
  rfc:                'rfc',
  clave:              'employee_code',
  employee_code:      'employee_code',
  status:             'status',
  estado:             'status',
  departamento:       'department',
  puesto:             'position',
  percepciones:       'gross_taxable',
  isr:                'isr',
  imss:               'imss_employee',
  infonavit:          'infonavit',
  periodo:            'period_label',
  fecha_pago:         'payment_date',
}

function normalizeHeader(header: string): string {
  return header.toString().trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

// Misma fórmula que mapPayrollValues() en excelParser.ts del backend, en su
// versión mínima (sin gross_exempt/other_deductions — no existen en el
// Excel genérico de nómina que produce este parser).
function withComputedPayrollFields(row: ParsedRow): ParsedRow {
  if (row.gross_taxable === undefined && row.isr === undefined) return row

  const gross_taxable = Number(row.gross_taxable) || 0
  const isr           = Number(row.isr) || 0
  const imss_employee = Number(row.imss_employee) || 0
  const infonavit      = Number(row.infonavit) || 0
  const total_deductions = isr + imss_employee + infonavit

  return {
    ...row,
    total_income:     Math.round(gross_taxable * 100) / 100,
    total_deductions: Math.round(total_deductions * 100) / 100,
    net_pay:          Math.round((gross_taxable - total_deductions) * 100) / 100,
  }
}

export function parseWorkbook(filePath: string): ParsedRow[] {
  const wb = XLSX.readFile(filePath)
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rawRows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: null })

  return rawRows.map((raw) => {
    let row: ParsedRow = {}
    for (const [header, value] of Object.entries(raw)) {
      if (value === null || value === '') continue
      const field = HEADER_MAP[normalizeHeader(header)]
      if (!field) continue

      if (field === '__full_name') {
        const parts = String(value).trim().split(/\s+/)
        row.first_name = parts[0] || ''
        row.last_name  = parts.slice(1).join(' ') || ''
        continue
      }
      row[field] = value
    }
    return withComputedPayrollFields(row)
  })
}

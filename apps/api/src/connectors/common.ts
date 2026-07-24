// ============================================================
// CÓDICE · Connectors — tipos compartidos
// Forma canónica de fila que cualquier conector (Excel, CONTPAQ
// XML, NOMIPAQ DBF) produce antes del upsert en `employees` /
// `payroll_records`.
// ============================================================

export interface EmployeeUpsertRow {
  first_name?:    string
  last_name?:     string
  rfc?:           string
  curp?:          string
  nss?:           string
  daily_salary?:  number
  monthly_salary?: number
  salary_base_imss?: number
  seniority_years?: number
  department?:    string
  position?:      string
  plant?:         string
  shift?:         string
  hire_date?:     Date
  contract_type?: string
  status?:        string
  employee_code?: string
  bank_name?:     string
  bank_clabe?:    string
  notes?:         string
  // Conectores "vivos" (Zoho/Monday/Odoo/Runa/Worky/Buk/Factorial — ver
  // connectors/{zoho,monday,odoo,runa,worky,buk,factorial}/*Connector.ts) y
  // cualquier conector futuro con estos datos. Ningún conector de archivo
  // (Excel/CFDI/DBF) los trae hoy, pero viven en `employees` desde siempre
  // (ver rutas manuales en routes/employees.ts) — solo faltaban en esta whitelist.
  email?:          string
  phone?:          string
  supervisor_name?: string
  customFields?:  Record<string, string> // ver upsertEmployee: se mergea (no sobreescribe) en employees.custom_fields
}

export interface PayrollUpsertRow {
  folio?:            string
  uuid_sat?:          string
  payroll_type?:      string
  period_start?:      Date
  period_end?:        Date
  payment_date?:      Date
  days_paid?:         number
  gross_taxable?:     number
  gross_exempt?:      number
  total_income?:      number
  isr?:               number
  imss_employee?:     number
  infonavit?:         number
  other_deductions?:  number
  total_deductions?:  number
  net_pay?:           number
  // Etiqueta de período (Excel genérico, sin folio/UUID fiscal) — junto con
  // payment_date es la llave de upsert cuando no hay uuid_sat ni un rango
  // period_start/period_end confiable. Ver upsertPayrollRecord.
  period_label?:      string
}

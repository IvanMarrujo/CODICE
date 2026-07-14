// ============================================================
// CÓDICE Agent · simulate (DEV ONLY) — crea ./watch/nomina.xlsx con
// datos de ejemplo si no existe, y luego arranca el mismo watcher +
// heartbeat que el agente real. Permite hacer la demo completa
// (editar Excel -> webhook -> cola -> socket -> móvil) en una sola
// máquina, sin un agente empaquetado de verdad.
// ============================================================

import * as fs   from 'fs'
import * as path from 'path'
import * as XLSX from 'xlsx'
import { loadConfig, printBanner } from './index'
import { startWatchers } from './watcher'
import { startHeartbeat } from './heartbeat'

function ensureSampleWorkbook(watchPath: string) {
  const dir = path.dirname(watchPath)
  fs.mkdirSync(dir, { recursive: true })
  if (fs.existsSync(watchPath)) {
    console.log(`[simulate] ya existe "${watchPath}" — no se sobreescribe`)
    return
  }

  // Sin columna NETO/DEDUCCIONES a propósito: el backend la calcula a partir
  // de PERCEPCIONES/ISR/IMSS/INFONAVIT (ver excelParser.ts) — así, editar
  // solo la celda de ISR ya cambia el neto reportado, como en la demo real.
  const rows = [
    ['nombre', 'rfc', 'PERCEPCIONES', 'ISR', 'IMSS', 'INFONAVIT', 'PERIODO', 'FECHA_PAGO'],
    ['Mariana Torres Vega', 'TOVM900101AB1', 6588.15, 1247, 300, 200, 'Q13', '2026-07-01'],
  ]
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, 'Nomina')
  XLSX.writeFile(wb, watchPath)
  console.log(`[simulate] archivo de ejemplo creado en "${watchPath}" (neto inicial ≈ $4,841.15)`)
}

function main() {
  const config = loadConfig()
  console.log('\n✦ CÓDICE Agent — MODO SIMULACIÓN (un solo equipo)')
  printBanner(config)

  for (const source of config.sources) {
    if (source.enabled && source.type === 'EXCEL' && !source.files) {
      ensureSampleWorkbook(source.watchPath)
    }
  }

  console.log('[simulate] edita el archivo de ejemplo y guarda — el cambio se sube solo.\n')
  startWatchers(config)
  startHeartbeat(config)
}

main()

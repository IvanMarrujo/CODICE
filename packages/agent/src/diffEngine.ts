// ============================================================
// CÓDICE Agent · diffEngine — el corazón de la arquitectura seamless.
// Compara la lectura actual del archivo contra el último estado
// conocido (persistido en agent-state.json, así el agente sobrevive
// un reinicio de la PC sin tener que resincronizar todo) y produce
// solo los campos que cambiaron por empleado.
// ============================================================

import * as fs from 'fs'
import * as path from 'path'
import { ParsedRow } from './excelParser'

export interface Delta {
  code: string
  type?: 'insert' | 'update' | 'delete'
  data?: Record<string, unknown>
  changes?: Record<string, { from: unknown; to: unknown }>
  // Campos de identidad que no cambiaron pero el servidor necesita para
  // encontrar el registro a actualizar (ver watcher.ts::splitDelta y
  // apps/api/src/lib/agentDelta.ts) — deliberadamente NO es la fila
  // completa, para no perder el ahorro de ancho de banda de mandar deltas.
  context?: Record<string, unknown>
}

const STATE_PATH = path.join(__dirname, '..', 'agent-state.json')

function rowKey(row: Record<string, unknown>): string | undefined {
  return (row.employee_code as string) || (row.rfc as string) || undefined
}

export class DiffEngine {
  private lastState: Map<string, ParsedRow> = new Map()

  constructor() {
    this.loadState()
  }

  computeDeltas(newRows: ParsedRow[]): Delta[] {
    const deltas: Delta[] = []
    const seen = new Set<string>()

    for (const row of newRows) {
      const key = rowKey(row)
      if (!key) continue
      seen.add(key)

      const prev = this.lastState.get(key)
      if (!prev) {
        deltas.push({ code: key, type: 'insert', data: row })
        continue
      }

      const changes: Record<string, { from: unknown; to: unknown }> = {}
      for (const [field, value] of Object.entries(row)) {
        if (prev[field] !== value) changes[field] = { from: prev[field] ?? null, to: value }
      }
      if (Object.keys(changes).length > 0) deltas.push({ code: key, type: 'update', changes })
    }

    for (const [code] of this.lastState) {
      if (!seen.has(code)) deltas.push({ code, type: 'delete' })
    }

    return deltas
  }

  updateState(newRows: ParsedRow[]): void {
    this.lastState.clear()
    for (const row of newRows) {
      const key = rowKey(row)
      if (key) this.lastState.set(key, row)
    }
    this.saveState()
  }

  size(): number {
    return this.lastState.size
  }

  private saveState(): void {
    fs.writeFileSync(STATE_PATH, JSON.stringify(Object.fromEntries(this.lastState)))
  }

  private loadState(): void {
    try {
      const data = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'))
      this.lastState = new Map(Object.entries(data))
      console.log(`[CÓDICE] Estado previo cargado: ${this.lastState.size} registros`)
    } catch {
      console.log('[CÓDICE] Sin estado previo — primera sincronización completa')
    }
  }
}

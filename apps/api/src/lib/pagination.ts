// ============================================================
// CÓDICE · Paginación compartida
// Metadata estándar (totalPages/hasNext/hasPrev) para toda lista paginada.
// ============================================================

import { z } from 'zod'

// Acepta `limit` (nombre nuevo, UI de paginación) o `pageSize` (nombre
// legacy, usado por llamadas que traen el tenant completo de una vez —
// ej. fetchEmployees(token) sin UI de paginación, ver Plantilla). Si se
// manda `limit`, tiene prioridad y respeta el tope de 100 pedido para la
// paginación real; `pageSize` conserva su tope histórico más alto.
export const paginationQuerySchema = z.object({
  page:     z.coerce.number().int().min(1).default(1),
  limit:    z.coerce.number().int().min(1).max(100).optional(),
  pageSize: z.coerce.number().int().min(1).max(2000).optional(),
})

export function resolvePageSize(input: { limit?: number; pageSize?: number }): number {
  return input.limit ?? input.pageSize ?? 25
}

export interface PaginationMeta {
  total:      number
  page:       number
  pageSize:   number
  limit:      number
  totalPages: number
  hasNext:    boolean
  hasPrev:    boolean
}

export function paginationMeta(page: number, pageSize: number, total: number): PaginationMeta {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  return {
    total, page, pageSize, limit: pageSize, totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  }
}

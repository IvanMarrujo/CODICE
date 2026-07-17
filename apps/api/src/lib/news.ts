// ============================================================
// CÓDICE · Tablero de avisos (news board) — lista en Redis, no en
// Postgres: son avisos efímeros (cap de 30, TTL implícito por trim),
// no registros que necesiten auditoría/historial largo plazo.
// Hoy el único productor es CÓDICE Radar (ver jobs/radarWeekly.ts) —
// los avisos "de RH" en el shell colaborador siguen siendo estáticos
// (AVISOS_PLACEHOLDER en EmpleadoShell.jsx) hasta que exista un editor.
// ============================================================

import * as crypto from 'crypto'
import { redis } from './redis'

const NEWS_CAP = 30

export interface NewsItem {
  id: string
  title: string
  summary: string
  tag: string          // 'SEGURIDAD' | 'GENERAL'
  urgency: 'alta' | 'media' | 'baja'
  url: string | null
  createdAt: string    // ISO — usado para el badge "Nuevo" (< 24h)
  source: string       // 'radar' | otro productor futuro
}

function newsKey(tenantId: string) { return `t:${tenantId}:news` }

export async function addNewsItem(tenantId: string, item: Omit<NewsItem, 'id' | 'createdAt'>): Promise<void> {
  const full: NewsItem = { ...item, id: crypto.randomUUID(), createdAt: new Date().toISOString() }
  await redis.lpush(newsKey(tenantId), JSON.stringify(full))
  await redis.ltrim(newsKey(tenantId), 0, NEWS_CAP - 1)
}

export async function getNews(tenantId: string, limit = NEWS_CAP): Promise<NewsItem[]> {
  const raw = await redis.lrange(newsKey(tenantId), 0, limit - 1)
  return raw.map((r) => JSON.parse(r))
}

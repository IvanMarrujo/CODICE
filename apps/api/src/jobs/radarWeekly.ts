// ============================================================
// CÓDICE Radar · Job semanal — lunes 07:00 (America/Mexico_City)
// Busca actualizaciones normativas/de industria (Anthropic web_search),
// las cruza con los perfiles de riesgo por depto del tenant, y genera
// un digest con Claude. Corre en el mismo proceso que la API (mismo
// patrón que jobs/dailyCourseDigest.ts — no hay worker separado).
//
// La lógica de "una corrida" (computeRadarDigest + runRadarForTenant)
// también la usa POST /api/radar/refresh (routes/radar.ts) para el
// botón "Actualizar ahora" — por eso vive aquí y no inline en el cron.
// ============================================================

import cron from 'node-cron'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { prismaPublic } from '../lib/prisma'
import { getTenantPrisma } from '../middleware/tenant'
import { redis } from '../lib/redis'
import { notifyHR } from '../lib/whatsapp'
import { addNewsItem } from '../lib/news'
import { getIO } from '../lib/syncEmitter'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const AI_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5'

const RADAR_TTL = 60 * 60 * 24 * 7 // 7 días

function radarCacheKey(tenantId: string) { return `t:${tenantId}:radar:latest` }

const SEARCH_QUERIES = [
  'NOM-030-STPS actualización 2025 2026 site:dof.gob.mx',
  'NOM-035-STPS cambios 2026 site:stps.gob.mx',
  'IMSS enfermedades trabajo manufactura alimentos 2026',
  'STPS multas seguridad higiene manufactura México 2026',
  'accidentes trabajo industria alimentos México 2026',
]

function stripJsonFences(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return fenced ? fenced[1] : trimmed
}

const radarItemSchema = z.object({
  titulo:   z.string(),
  resumen:  z.string(),
  urgencia: z.enum(['alta', 'media', 'baja']),
  url:      z.string().nullable().optional(),
  norma:    z.string().nullable().optional(),
  aplicaA:  z.array(z.string()).optional().default([]),
})
const radarResponseSchema = z.object({ items: z.array(radarItemSchema) })

export interface RadarItem {
  titulo: string
  resumen: string
  urgencia: 'alta' | 'media' | 'baja'
  url: string | null
  norma: string | null
  aplicaA: string[]
}

interface RadarDigest {
  generatedAt: string
  items: RadarItem[]
  summary: { alta: number; media: number; baja: number }
  sourcesSearched: string[]
}

// ── Búsqueda + análisis con Claude (web_search server-side tool) ──
// El SDK instalado (0.32.x) es previo a la introducción de este tool
// tipado — se define el bloque `tools` con un cast porque a nivel de
// wire protocol la API sí lo soporta (mismo patrón que el cast de
// `beta.messages.create` para PDFs en health.ts).

async function searchAndAnalyze(
  tenant: { name: string; industry: string },
  deptProfiles: any[]
): Promise<{ items: RadarItem[]; sourcesSearched: string[] }> {
  const deptContext = deptProfiles.map((d) => ({
    department: d.department,
    riesgosOcupacionales: d.riesgos_ocupacionales,
    examenRequerido: d.perfil_optimo?.examenRequerido ?? null,
    condicionesIncompatibles: d.perfil_optimo?.condicionesIncompatibles ?? [],
  }))

  const system = `Eres el asesor de Seguridad e Higiene de ${tenant.name}.
Analiza estas actualizaciones normativas y de industria.
Identifica solo lo relevante para una empresa de ${tenant.industry}.
Responde SOLO con JSON: { items: [{ titulo, resumen, urgencia: 'alta'|'media'|'baja', url, norma, aplicaA: string[] }] }
"aplicaA" debe listar los nombres exactos de los departamentos (de los que te doy en el contexto) a los que afecta cada actualización, o [] si es general.
Si no hay nada relevante, responde { items: [] } — no inventes actualizaciones.`

  const user = `Busca actualizaciones oficiales usando estas consultas (una búsqueda web por cada una):
${SEARCH_QUERIES.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Departamentos de la operación y su perfil de riesgo actual:
${JSON.stringify(deptContext, null, 2)}

Para cada resultado relevante, evalúa:
- ¿Es una norma nueva o modificada que afecta alguno de estos departamentos?
- ¿Hay un patrón de incidentes de industria que coincida con los riesgos ya identificados?
- ¿Cambian los requisitos de examen médico?

Al final, responde ÚNICAMENTE con el JSON pedido (sin texto antes o después).`

  const response = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 2500,
    system,
    messages: [{ role: 'user', content: user }],
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }],
  } as any)

  const content = response.content as any[]
  const sourcesSearched = content
    .filter((b) => b.type === 'server_tool_use' && b.name === 'web_search')
    .map((b) => b.input?.query)
    .filter(Boolean)

  const textBlocks = content.filter((b) => b.type === 'text') as { type: 'text'; text: string }[]
  const text = textBlocks.map((b) => b.text).join('\n').trim()
  if (!text) throw new Error('Respuesta de IA sin contenido de texto')

  const parsed = radarResponseSchema.parse(JSON.parse(stripJsonFences(text)))

  return {
    items: parsed.items.map((i) => ({ ...i, url: i.url ?? null, norma: i.norma ?? null })),
    sourcesSearched: sourcesSearched.length ? sourcesSearched : SEARCH_QUERIES,
  }
}

// ── Corrida completa para un tenant (job semanal o refresh manual) ─

export async function runRadarForTenant(tenantId: string, tenantDb: any, tenant: { name: string; industry: string }): Promise<RadarDigest> {
  const deptProfiles = await tenantDb.$queryRaw<any[]>`
    SELECT department, riesgos_ocupacionales, perfil_optimo FROM department_risk_profiles WHERE tenant_id = ${tenantId}
  `

  let items: RadarItem[] = []
  let sourcesSearched: string[] = SEARCH_QUERIES

  try {
    const result = await searchAndAnalyze(tenant, deptProfiles)
    items = result.items
    sourcesSearched = result.sourcesSearched
  } catch (err: any) {
    console.error(`❌  CÓDICE Radar: búsqueda/análisis falló para tenant ${tenantId}:`, err.message)
    // Degradación controlada: no tumbar el job completo, el digest queda
    // vacío para esta corrida (mejor "sin alertas" que un job caído).
    items = []
  }

  const summary = { alta: 0, media: 0, baja: 0 }
  for (const item of items) summary[item.urgencia]++

  const digest: RadarDigest = { generatedAt: new Date().toISOString(), items, summary, sourcesSearched }

  await redis.set(radarCacheKey(tenantId), JSON.stringify(digest), 'EX', RADAR_TTL)

  await tenantDb.$executeRaw`
    INSERT INTO radar_digests (tenant_id, items, alta_count, media_count, baja_count, sources_searched)
    VALUES (${tenantId}, ${JSON.stringify(items)}::jsonb, ${summary.alta}, ${summary.media}, ${summary.baja}, ${JSON.stringify(sourcesSearched)}::jsonb)
  `

  getIO()?.to(`tenant:${tenantId}`).emit('radar:updated', { generatedAt: digest.generatedAt, summary })

  const altaItems = items.filter((i) => i.urgencia === 'alta')
  if (altaItems.length > 0) {
    for (const item of altaItems) {
      await addNewsItem(tenantId, {
        title: item.titulo,
        summary: item.resumen,
        tag: 'SEGURIDAD',
        urgency: 'alta',
        url: item.url,
        source: 'radar',
      }).catch(() => {})
    }

    const normas = [...new Set(altaItems.map((i) => i.norma).filter(Boolean))].slice(0, 3).join(', ') || 'N/A'
    notifyHR(
      tenantId, 'seguridad',
      `⚠️ CÓDICE Radar · Nueva alerta de seguridad\n${altaItems.length} actualización(es) que requieren atención.\nNorma: ${normas}\nRevisa el Radar en CÓDICE.`
    ) // fire-and-forget — nunca await (ver PART 3 de health.ts)
  }

  return digest
}

async function runForActiveTenants(): Promise<void> {
  const tenants = await prismaPublic.tenant.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true, industry: true, dbSchema: true },
  })

  for (const t of tenants) {
    try {
      const tenantDb = await getTenantPrisma(t.dbSchema)
      await tenantDb.$executeRawUnsafe(`SET search_path = "${t.dbSchema}", public`)
      await runRadarForTenant(t.id, tenantDb, { name: t.name, industry: t.industry })
      console.log(`✅  CÓDICE Radar: digest generado para tenant ${t.id}`)
    } catch (err: any) {
      console.error(`❌  CÓDICE Radar falló para tenant ${t.id}:`, err.message)
    }
  }
}

export function startRadarWeekly(): void {
  cron.schedule('0 7 * * 1', () => {
    runForActiveTenants().catch((err) => console.error('❌  radarWeekly falló:', err.message))
  }, { timezone: 'America/Mexico_City' })
}

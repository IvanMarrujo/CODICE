// ============================================================
// CÓDICE · WhatsApp — envío de notificaciones + config por tenant
// Sin credenciales reales (globales o de tenant) cae en modo mock:
// no llama a ningún servicio externo, solo registra el intento en
// Redis para que la UI tenga algo que mostrar en "Actividad reciente".
// ============================================================

import { redis } from './redis'
import { prismaPublic } from './prisma'

interface WhatsAppConfig {
  instanceId: string
  token: string
}

export interface WhatsAppNotificationSettings {
  solicitudes:   boolean
  nomina:        boolean
  salud:         boolean
  capacitacion:  boolean
}

const DEFAULT_SETTINGS: WhatsAppNotificationSettings = {
  solicitudes: true, nomina: true, salud: true, capacitacion: true,
}

function configKey(tenantId: string)   { return `t:${tenantId}:whatsapp:config` }
function settingsKey(tenantId: string) { return `t:${tenantId}:whatsapp:settings` }
function mockLogKey(tenantId: string)  { return `t:${tenantId}:whatsapp:mock:log` }

// ── Config por tenant (instancia/token) ─────────────────────────
// Cada tenant tiene su propio número de WhatsApp Business — las
// credenciales no pueden ser variables de entorno globales del
// servicio (eso rompería el aislamiento multi-tenant). Las variables
// GREEN_API_* siguen existiendo como fallback para un despliegue de
// un solo tenant sin configuración explícita todavía.

export async function getWhatsAppConfig(tenantId: string): Promise<WhatsAppConfig | null> {
  const raw = await redis.get(configKey(tenantId))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed.instanceId || !parsed.token) return null
    return parsed
  } catch {
    return null
  }
}

export async function setWhatsAppConfig(tenantId: string, config: WhatsAppConfig): Promise<void> {
  await redis.set(configKey(tenantId), JSON.stringify(config))
}

export async function getNotificationSettings(tenantId: string): Promise<WhatsAppNotificationSettings> {
  const raw = await redis.get(settingsKey(tenantId))
  if (!raw) return { ...DEFAULT_SETTINGS }
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export async function setNotificationSettings(tenantId: string, settings: Partial<WhatsAppNotificationSettings>): Promise<WhatsAppNotificationSettings> {
  const current = await getNotificationSettings(tenantId)
  const next = { ...current, ...settings }
  await redis.set(settingsKey(tenantId), JSON.stringify(next))
  return next
}

export async function isConnected(tenantId: string): Promise<boolean> {
  const tenantConfig = await getWhatsAppConfig(tenantId)
  if (tenantConfig) return true
  return !!(process.env.GREEN_API_INSTANCE_ID && process.env.GREEN_API_TOKEN)
}

// ── Envío ────────────────────────────────────────────────────────

export async function sendWhatsApp(phone: string, message: string, tenantId?: string) {
  const tenantConfig = tenantId ? await getWhatsAppConfig(tenantId) : null
  const instanceId = tenantConfig?.instanceId || process.env.GREEN_API_INSTANCE_ID
  const token      = tenantConfig?.token      || process.env.GREEN_API_TOKEN
  const baseUrl    = process.env.GREEN_API_URL || 'https://api.green-api.com'

  if (!instanceId || !token) {
    const entry = JSON.stringify({ phone, message, ts: new Date().toISOString() })
    if (tenantId) {
      await redis.lpush(mockLogKey(tenantId), entry)
      await redis.ltrim(mockLogKey(tenantId), 0, 49)
    }
    console.log('[WhatsApp MOCK]', phone, message)
    return { mock: true }
  }

  const url = `${baseUrl}/waInstance${instanceId}/sendMessage/${token}`
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chatId: `${phone}@c.us`, message }),
  })
  if (!res.ok) throw new Error(`WhatsApp send falló (${res.status})`)
  return res.json()
}

export async function getMockLog(tenantId: string) {
  const entries = await redis.lrange(mockLogKey(tenantId), 0, 9)
  return entries.map((e) => JSON.parse(e))
}

// ── Helper de destino: teléfono del HR Manager del tenant ───────

export async function getHRPhone(tenantId: string): Promise<string | null> {
  const admin = await prismaPublic.adminUser.findFirst({
    where:  { tenantId, role: 'HR_MANAGER', isActive: true },
    select: { phone: true },
  })
  return admin?.phone || null
}

// Envía una notificación al HR Manager si el tipo correspondiente está
// activo en la config del tenant. Fire-and-forget por diseño — los
// callers NUNCA hacen await de esta función (ver PART 3 del feature).
export async function notifyHR(tenantId: string, kind: keyof WhatsAppNotificationSettings, message: string): Promise<void> {
  try {
    const settings = await getNotificationSettings(tenantId)
    if (!settings[kind]) return
    const phone = await getHRPhone(tenantId)
    if (!phone) return
    await sendWhatsApp(phone, message, tenantId)
  } catch (err: any) {
    console.error(`❌  notifyHR(${kind}) falló:`, err.message)
  }
}

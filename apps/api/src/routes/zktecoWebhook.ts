// ============================================================
// CÓDICE · ZKTeco ADMS push — POST /api/webhook/attendance/zkteco
// El dispositivo (UA760) empuja asistencia en tiempo real, sin sesión ni
// JWT — este router se monta ANTES de authMiddleware/tenantMiddleware
// (ver index.ts) y resuelve el tenant a mano por número de serie (SN),
// igual que routes/webhook.ts hace con el agente local.
//
// Contrato de respuesta: ZKTeco espera EXACTAMENTE "200 OK" (texto plano
// "OK") — cualquier otra respuesta hace que el dispositivo reintente el
// push indefinidamente. Por eso el handler completo responde 200 "OK"
// incluso ante errores internos (se loguean, nunca se propagan).
// ============================================================

import { Router, Request, Response } from 'express'
import multer from 'multer'
import { redis } from '../lib/redis'
import { prismaPublic } from '../lib/prisma'
import { getTenantPrisma } from '../middleware/tenant'
import { awardXP, updateStreak } from '../lib/gamification'

const router = Router()

// Solo campos de texto (SN, table, Stamp, data) — el ADMS no manda archivos.
const parseForm = multer().none()

function snKey(sn: string) { return `codice:zkteco:sn:${sn}` }
const SN_CACHE_TTL = 60 * 60 * 24 * 30 // 30 días

const VERIFY_MODE_MAP: Record<string, string> = { '1': 'fingerprint', '4': 'card', '15': 'face' }

interface ParsedPunch {
  pin: string
  timestamp: Date
  type: 'entry' | 'exit'
  verifyMode: string | null
}

// ── Resolución de tenant por SN — Redis primero, tabla global como fuente
// de verdad. El tenant NO se conoce hasta este paso, así que la búsqueda no
// puede usar la tabla `zkteco_devices` de ningún schema de tenant — solo la
// global `public.zkteco_devices` (sn PK único entre todos los tenants).

async function resolveTenantBySN(sn: string): Promise<{ tenantId: string; dbSchema: string } | null> {
  const cachedTenantId = await redis.get(snKey(sn))
  if (cachedTenantId) {
    const tenant = await prismaPublic.tenant.findUnique({ where: { id: cachedTenantId }, select: { dbSchema: true, status: true } })
    if (tenant && tenant.status === 'ACTIVE') return { tenantId: cachedTenantId, dbSchema: tenant.dbSchema }
  }

  const rows = await prismaPublic.$queryRawUnsafe<{ tenant_id: string }[]>(
    `SELECT tenant_id FROM public.zkteco_devices WHERE sn = $1 LIMIT 1`, sn
  ).catch(() => [] as { tenant_id: string }[])
  const tenantId = rows[0]?.tenant_id
  if (!tenantId) return null

  const tenant = await prismaPublic.tenant.findUnique({ where: { id: tenantId }, select: { dbSchema: true, status: true } })
  if (!tenant || tenant.status !== 'ACTIVE') return null

  await redis.set(snKey(sn), tenantId, 'EX', SN_CACHE_TTL)
  return { tenantId, dbSchema: tenant.dbSchema }
}

// ── Parseo de ATTLOG — "PIN\tFecha\tStatus\tVerifyMode\tWorkCode\n" ────
// Status: 0=Check-In, resto (1=Check-Out, 2=Break-Out, 3=Break-In,
// 4=OT-In, 5=OT-Out) se trata como salida — mismo binario entry/exit que
// ya usa el modelo de asistencia existente (una fila por día).

function parseAttlog(data: string): ParsedPunch[] {
  const punches: ParsedPunch[] = []
  for (const rawLine of data.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const [pinRaw, dateStr, status, verifyModeRaw] = line.split('\t')
    if (!pinRaw || !dateStr) continue
    const timestamp = new Date(dateStr.trim().replace(' ', 'T'))
    if (isNaN(timestamp.getTime())) continue
    punches.push({
      pin: pinRaw.trim(),
      timestamp,
      type: status?.trim() === '0' ? 'entry' : 'exit',
      verifyMode: VERIFY_MODE_MAP[(verifyModeRaw || '').trim()] ?? null,
    })
  }
  return punches
}

async function findEmployeeByPin(tenantDb: any, tenantId: string, pin: string) {
  const padded = pin.padStart(4, '0')
  const rows = await tenantDb.$queryRaw<any[]>`
    SELECT id, employee_code, full_name FROM employees
    WHERE tenant_id = ${tenantId} AND (employee_code = ${pin} OR employee_code = ${padded})
    LIMIT 1
  `
  return rows[0] || null
}

// Upsert de la fila del día (mismo modelo "un registro por colaborador por
// día" que ya usa /api/attendance/checkin — ver routes/attendance.ts).
async function upsertPunch(tenantDb: any, tenantId: string, employeeId: string, punch: ParsedPunch, sn: string) {
  const existingRows = await tenantDb.$queryRaw<any[]>`
    SELECT * FROM attendance_records
    WHERE employee_id = ${employeeId} AND tenant_id = ${tenantId} AND check_in_at::date = ${punch.timestamp}::date
    LIMIT 1
  `
  const existing = existingRows[0]
  let isNewEntry = false
  let record: any

  if (!existing) {
    // Backfill/reinicio del dispositivo: una 'exit' puede llegar sin 'entry'
    // previa el mismo día — check_in_at es NOT NULL, se usa el mismo
    // timestamp para no romper la fila.
    const rows = await tenantDb.$queryRaw<any[]>`
      INSERT INTO attendance_records
        (tenant_id, employee_id, check_in_at, check_out_at, method, verify_mode, device_sn, mock)
      VALUES (
        ${tenantId}, ${employeeId}, ${punch.timestamp},
        ${punch.type === 'exit' ? punch.timestamp : null},
        'ZKTECO_ADMS', ${punch.verifyMode}, ${sn}, false
      )
      RETURNING *
    `
    record = rows[0]
    isNewEntry = punch.type === 'entry'
  } else if (punch.type === 'entry') {
    // Ya hay entrada hoy (doble punch, ej. huella + tarjeta) — nunca pisa
    // check_in_at, solo refresca metadata del último punch.
    const rows = await tenantDb.$queryRaw<any[]>`
      UPDATE attendance_records SET verify_mode = ${punch.verifyMode}, device_sn = ${sn}
      WHERE id = ${existing.id} AND tenant_id = ${tenantId}
      RETURNING *
    `
    record = rows[0]
  } else {
    const rows = await tenantDb.$queryRaw<any[]>`
      UPDATE attendance_records SET check_out_at = ${punch.timestamp}, verify_mode = ${punch.verifyMode}, device_sn = ${sn}
      WHERE id = ${existing.id} AND tenant_id = ${tenantId}
      RETURNING *
    `
    record = rows[0]
  }

  return { record, isNewEntry }
}

// ── POST /api/webhook/attendance/zkteco ────────────────────────

router.post('/attendance/zkteco', parseForm, async (req: Request, res: Response) => {
  try {
    const sn = String(req.body?.SN || '').trim()
    const table = String(req.body?.table || '')
    if (!sn) return res.status(200).send('OK')

    const tenant = await resolveTenantBySN(sn)
    if (!tenant) return res.status(200).send('OK') // dispositivo desconocido — se ignora en silencio

    const tenantDb = await getTenantPrisma(tenant.dbSchema)
    await tenantDb.$executeRawUnsafe(`SET search_path = "${tenant.dbSchema}", public`)

    await tenantDb.$executeRaw`
      UPDATE zkteco_devices SET last_ping = NOW() WHERE tenant_id = ${tenant.tenantId} AND sn = ${sn}
    `.catch(() => {})

    if (table !== 'ATTLOG') return res.status(200).send('OK') // OPERLOG/ATTPHOTO — solo heartbeat, sin asistencia

    const punches = parseAttlog(String(req.body?.data || ''))
    const io = req.app.get('io')

    for (const punch of punches) {
      try {
        const employee = await findEmployeeByPin(tenantDb, tenant.tenantId, punch.pin)
        if (!employee) {
          console.warn(`⚠️  ZKTeco ADMS: PIN desconocido "${punch.pin}" (SN ${sn}, tenant ${tenant.tenantId})`)
          continue
        }

        const { isNewEntry } = await upsertPunch(tenantDb, tenant.tenantId, employee.id, punch, sn)

        io?.to(`tenant:${tenant.tenantId}`).emit('attendance:punch', {
          employeeId:   employee.id,
          employeeName: employee.full_name,
          type:         punch.type,
          timestamp:    punch.timestamp.toISOString(),
          verifyMode:   punch.verifyMode,
          deviceSn:     sn,
        })
        io?.to(`tenant:${tenant.tenantId}`).emit('headcount:refresh', {})
        io?.to(`employee:${employee.id}`).emit('attendance:recorded', {
          type:      punch.type,
          timestamp: punch.timestamp.toISOString(),
          message:   punch.type === 'entry' ? 'Entrada registrada' : 'Salida registrada',
        })

        // Fire-and-forget — solo en la primera entrada del día (no en cada
        // punch duplicado ni en la salida) para no otorgar XP varias veces.
        if (isNewEntry) {
          awardXP(tenantDb, tenant.tenantId, employee.id, 'DAILY_ATTENDANCE', 'Check-in ZKTeco')
          updateStreak(tenantDb, tenant.tenantId, employee.id)
        }
      } catch (lineErr: any) {
        console.error(`❌  ZKTeco ADMS: error procesando punch (PIN ${punch.pin}):`, lineErr.message)
      }
    }

    res.status(200).send('OK')
  } catch (err: any) {
    console.error('❌  ZKTeco ADMS webhook falló:', err.message)
    res.status(200).send('OK')
  }
})

export default router

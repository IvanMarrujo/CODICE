// ============================================================
// CÓDICE · API Entry Point
// Node.js + Express + TypeScript
// ============================================================

import 'dotenv/config'
import express        from 'express'
import cors           from 'cors'
import helmet         from 'helmet'
import morgan         from 'morgan'
import { createServer }  from 'http'
import { Server as SocketIO } from 'socket.io'

import { tenantMiddleware } from './middleware/tenant'
import { authMiddleware }   from './middleware/auth'
import { rateLimitMiddleware } from './middleware/rateLimit'
import { errorHandler }     from './middleware/errorHandler'

// Routes
import authRoutes       from './routes/auth'
import lftRoutes        from './routes/lft'
import employeeRoutes   from './routes/employees'
import healthRoutes     from './routes/health'
import contractRoutes   from './routes/contracts'
import payrollRoutes    from './routes/payroll'
import requestRoutes    from './routes/requests'
import courseRoutes     from './routes/courses'
import actaRoutes       from './routes/actas'
import connectorRoutes, { runReloadForSource } from './routes/connectors'
import aiRoutes         from './routes/ai'
import signageRoutes    from './routes/signage'
import notificationRoutes from './routes/notifications'
import attendanceRoutes from './routes/attendance'
import adminRoutes      from './routes/admin'
import auspexRoutes     from './routes/auspex'    // master cockpit (Auspex)
import { startAutoSyncWorker } from './jobs/autoSyncQueue'
import { setIO } from './lib/syncEmitter'
import webhookRoutes from './routes/webhook'
import whatsappWebhookRoutes from './routes/whatsappWebhook'
import settingsRoutes from './routes/settings'
import { startDailyCourseDigest } from './jobs/dailyCourseDigest'

const PORT = process.env.API_PORT || 3001

// ── Express app ──────────────────────────────────────────────
const app    = express()
const server = createServer(app)
const io     = new SocketIO(server, {
  cors: { origin: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000', credentials: true }
})

// Adjuntar io al request para usarlo en handlers
app.set('io', io)
// Registro para lib/syncEmitter.ts — el worker de BullMQ (sin req/app) emite
// eventos de sync a través de este singleton, no de app.get('io').
setIO(io)

// ── Global middleware ────────────────────────────────────────
app.use(helmet())

// Además del origin configurado, permite acceso desde cualquier IP de red
// local en el puerto 3000 (dev en teléfono/tablet vía la IP de red del
// equipo que corre `vite --host`), sin abrir CORS a todo internet.
const LAN_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}):3000$/

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true) // requests sin Origin (curl, health checks)
    const configured = process.env.NEXT_PUBLIC_APP_URL
    if (origin === configured || LAN_ORIGIN_RE.test(origin)) return callback(null, true)
    callback(new Error('Origen no permitido por CORS'))
  },
  credentials: true,
}))
app.use(morgan('dev'))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// ── Health check (sin auth) ──────────────────────────────────
app.get('/health', (_, res) => {
  res.json({
    status:  'ok',
    service: 'codice-api',
    version: '0.1.0',
    ts:      new Date().toISOString(),
  })
})

// ── Public routes (sin auth) ─────────────────────────────────
app.use('/api/auth', authRoutes)
app.use('/api/lft',  lftRoutes)   // calculadoras LFT — puras, sin DB ni auth
app.use('/api/webhook', webhookRoutes) // el agente se autentica con HMAC propio, no JWT
// El mensaje entrante de WhatsApp no trae un JWT nuestro; /whatsapp/simulate
// (mismo router) aplica requireHR internamente sobre esa única ruta.
app.use('/api/webhook', whatsappWebhookRoutes)

// ── Authenticated routes ─────────────────────────────────────
// Orden: rateLimiter → JWT auth → tenant resolver → route handler
app.use('/api',
  rateLimitMiddleware,
  authMiddleware,
  tenantMiddleware,   // setea req.tenant + req.tenantDb (Prisma en schema del tenant)
)

app.use('/api/employees',  employeeRoutes)
app.use('/api/employees',  healthRoutes)
app.use('/api/contracts',  contractRoutes)
app.use('/api/payroll',    payrollRoutes)
app.use('/api/requests',   requestRoutes)
app.use('/api/courses',    courseRoutes)
app.use('/api/actas',      actaRoutes)
app.use('/api/connectors', connectorRoutes)
app.use('/api/ai',         aiRoutes)
app.use('/api/signage',    signageRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/attendance', attendanceRoutes)
app.use('/api/admin',      adminRoutes)
app.use('/api/settings',   settingsRoutes)

// Auspex (solo SUPER_ADMIN)
app.use('/api/auspex', auspexRoutes)

// ── Error handler (siempre al final) ────────────────────────
app.use(errorHandler)

// ── Socket.io — notificaciones en tiempo real ────────────────
io.on('connection', (socket) => {
  // El cliente se une a su sala de tenant al conectar
  socket.on('join:tenant', (tenantId: string) => {
    socket.join(`tenant:${tenantId}`)
  })
  // El colaborador se une a su sala personal
  socket.on('join:employee', (employeeId: string) => {
    socket.join(`employee:${employeeId}`)
  })
})

// ── Auto-sync (BullMQ, in-process) ──────────────────────────
startAutoSyncWorker(io, runReloadForSource)

// ── Digest diario 8am — cursos obligatorios pendientes ───────
startDailyCourseDigest()

// ── Start ────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🚀 CÓDICE API corriendo en http://localhost:${PORT}`)
  console.log(`   Socket.io listo`)
  console.log(`   Worker de auto-sync listo`)
  console.log(`   Entorno: ${process.env.NODE_ENV || 'development'}\n`)
})

export { io }

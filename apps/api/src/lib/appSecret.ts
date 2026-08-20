// ============================================================
// CÓDICE · App secret — NO por-tenant
// Usado para dos cosas que no tienen relación con el HMAC del
// sync-agent (ver routes/webhook.ts, lib/agentWs.ts — esos ahora usan
// Tenant.webhookSecret, uno random distinto por tenant):
//   - Derivar la clave AES-256-GCM que cifra credenciales Odoo en reposo
//     (connectors/odoo/odooConnector.ts)
//   - El hash anti-tampering de actas / firma digital (routes/actas.ts)
//
// Ambos siguen siendo globales a propósito: no están scoped a "qué
// tenant firmó una request", así que no aplica el mismo fix. Hacerlos
// per-tenant es una migración aparte (habría que re-cifrar las
// credenciales Odoo ya guardadas con la clave vieja).
//
// Fallback a WEBHOOK_SECRET (nombre viejo) para no romper producción si
// el env var en Railway todavía no se renombró — quitar el fallback una
// vez que APP_SECRET esté seteado ahí.
// ============================================================

const resolved = process.env.APP_SECRET || process.env.WEBHOOK_SECRET

if (!resolved) {
  throw new Error(
    'APP_SECRET no configurado (ni WEBHOOK_SECRET como fallback). ' +
    'Requerido para cifrar credenciales Odoo y firmar actas. Genera uno con: ' +
    'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))" ' +
    'y agrégalo a .env / Railway como APP_SECRET.'
  )
}

export const APP_SECRET: string = resolved

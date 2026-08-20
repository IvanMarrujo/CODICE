#!/usr/bin/env ts-node
// ============================================================
// CÓDICE · rotateWebhookSecrets.ts
// Genera un webhookSecret nuevo (crypto-random, 32 bytes) para cada
// tenant que no tenga uno todavía (backfill) o, con --force, para
// TODOS los tenants (rotación completa — invalida agentes ya
// desplegados, que necesitarán descargar config.json de nuevo desde
// el panel de Conectores).
//
// Uso:
//   npx ts-node scripts/rotateWebhookSecrets.ts            # solo backfill (null -> nuevo)
//   npx ts-node scripts/rotateWebhookSecrets.ts --force     # rota TODOS, incluso los que ya tienen uno
//   npx ts-node scripts/rotateWebhookSecrets.ts --force --slug=gfp   # rota solo un tenant
// ============================================================

import * as path from 'path'
import * as dotenv from 'dotenv'
dotenv.config({ path: path.join(__dirname, '../.env') })

import { PrismaClient } from '@prisma/client'
import * as crypto from 'crypto'

const args   = process.argv.slice(2)
const force  = args.includes('--force')
const slugArg = args.find((a) => a.startsWith('--slug='))
const onlySlug = slugArg ? slugArg.split('=')[1] : undefined

function log(emoji: string, msg: string) {
  console.log(`${emoji}  ${msg}`)
}

async function main() {
  const prisma = new PrismaClient({ log: ['error'] })

  const where: any = force
    ? (onlySlug ? { slug: onlySlug } : {})
    : { webhookSecret: null }

  const tenants = await prisma.tenant.findMany({
    where,
    select: { id: true, slug: true, name: true, webhookSecret: true },
  })

  if (tenants.length === 0) {
    log('✅', force ? 'No hay tenants que coincidan con el filtro.' : 'Todos los tenants ya tienen webhookSecret — nada que hacer.')
    await prisma.$disconnect()
    return
  }

  log('🔐', `${force ? 'Rotando' : 'Generando'} webhookSecret para ${tenants.length} tenant(s)...\n`)

  for (const tenant of tenants) {
    const newSecret = crypto.randomBytes(32).toString('hex')
    await prisma.tenant.update({
      where: { id: tenant.id },
      data:  { webhookSecret: newSecret },
    })
    const hadOne = !!tenant.webhookSecret
    log(hadOne ? '🔄' : '🆕', `${tenant.slug.padEnd(20)} (${tenant.name})`)
  }

  console.log('\n' + '═'.repeat(60))
  console.log(`✅  ${tenants.length} secreto(s) actualizados.`)
  if (force) {
    console.log('⚠️   Cualquier agente/config.json ya desplegado con el secreto')
    console.log('    anterior dejará de autenticar. Cada tenant afectado debe')
    console.log('    volver a descargar el agente desde el panel de Conectores')
    console.log('    (GET /api/connectors/download-agent/:tenantId) para obtener')
    console.log('    el config.json con el nuevo secreto.')
  }
  console.log('═'.repeat(60) + '\n')

  await prisma.$disconnect()
}

main().catch((err) => {
  console.error('\n❌  Error:', err.message)
  process.exit(1)
})

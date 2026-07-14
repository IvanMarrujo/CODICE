// ============================================================
// CÓDICE Agent · uploader — sube el archivo cambiado al webhook
// HMAC de la API (mismo firmado que verifyHmac en routes/webhook.ts).
// ============================================================

import axios       from 'axios'
import FormData     from 'form-data'
import * as fs      from 'fs'
import * as path    from 'path'
import * as crypto  from 'crypto'
import { AgentConfig, SourceConfig } from './index'

function signedHeaders(config: AgentConfig): Record<string, string> {
  const timestamp = Date.now().toString()
  const signature = crypto
    .createHmac('sha256', config.webhookSecret)
    .update(`${config.tenantId}:${timestamp}`)
    .digest('hex')
  return {
    'X-Codice-Secret':  signature,
    'X-Timestamp':      timestamp,
    'X-Agent-Version':  config.agentVersion,
  }
}

const MAX_ATTEMPTS = 3

/** Sube `files` para `source` — reintenta hasta MAX_ATTEMPTS veces con backoff exponencial. */
export async function sendSync(config: AgentConfig, source: SourceConfig, files: string[], attempt = 1): Promise<void> {
  const form = new FormData()
  for (const filePath of files) {
    form.append('files', fs.createReadStream(filePath), path.basename(filePath))
  }

  const url = `${config.apiUrl}/api/webhook/sync/${config.tenantId}/${source.type}`
  const headers = { ...signedHeaders(config), ...form.getHeaders() }

  try {
    const res = await axios.post(url, form, { headers })
    if (res.status === 202) {
      console.log(`[uploader] ${source.type}: sync aceptado (202) · sourceId=${res.data?.sourceId ?? '—'}`)
    } else {
      console.warn(`[uploader] ${source.type}: respuesta inesperada (${res.status})`)
    }
  } catch (err: any) {
    const message = err.response?.data?.error || err.message
    if (attempt >= MAX_ATTEMPTS) {
      console.error(`[uploader] ${source.type}: falló tras ${MAX_ATTEMPTS} intentos — ${message}`)
      throw err
    }
    const delay = 2000 * 2 ** (attempt - 1)
    console.warn(`[uploader] ${source.type}: intento ${attempt}/${MAX_ATTEMPTS} falló (${message}), reintentando en ${delay}ms…`)
    await new Promise((resolve) => setTimeout(resolve, delay))
    return sendSync(config, source, files, attempt + 1)
  }
}

// ============================================================
// CÓDICE · Storage helper
// Sube a Cloudflare R2 si está configurado; si no (dev sin
// credenciales reales), escribe el archivo en el tmp local.
// ============================================================

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import * as fs   from 'fs'
import * as os   from 'os'
import * as path from 'path'

function isPlaceholder(value: string | undefined): boolean {
  return !value || value.startsWith('REPLACE')
}

function r2Configured(): boolean {
  return !isPlaceholder(process.env.R2_ACCOUNT_ID) &&
         !isPlaceholder(process.env.R2_ACCESS_KEY_ID) &&
         !isPlaceholder(process.env.R2_SECRET_ACCESS_KEY)
}

let s3Client: S3Client | null = null
function getS3(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region:      'auto',
      endpoint:    `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId:     process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    })
  }
  return s3Client
}

/**
 * Guarda un PDF bajo `key`. Sube a R2 si hay credenciales reales;
 * si no, lo escribe en el directorio temporal del SO (dev local).
 * Devuelve la URL pública (R2) o la ruta local del archivo.
 */
export async function savePdf(key: string, buffer: Buffer): Promise<string> {
  if (r2Configured()) {
    const bucket = `${process.env.R2_BUCKET_PREFIX || 'codice-dev'}-pdfs`
    await getS3().send(new PutObjectCommand({
      Bucket: bucket, Key: key, Body: buffer, ContentType: 'application/pdf',
    }))
    const base = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '')
    return `${base}/${key}`
  }

  const dir = path.join(os.tmpdir(), 'codice-pdfs')
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, key.replace(/\//g, '_'))
  fs.writeFileSync(filePath, buffer)
  return filePath
}

// ============================================================
// CÓDICE · Storage helper
// Sube a Cloudflare R2 si está configurado; si no (dev sin
// credenciales reales), escribe el archivo en el tmp local.
// ============================================================

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import * as fs   from 'fs'
import * as os   from 'os'
import * as path from 'path'

function isPlaceholder(value: string | undefined): boolean {
  return !value || value.startsWith('REPLACE')
}

let warnedMissingR2 = false

export function r2Configured(): boolean {
  const configured = !isPlaceholder(process.env.R2_ACCOUNT_ID) &&
    !isPlaceholder(process.env.R2_ACCESS_KEY_ID) &&
    !isPlaceholder(process.env.R2_SECRET_ACCESS_KEY)
  if (!configured && !warnedMissingR2) {
    warnedMissingR2 = true
    console.warn('[CÓDICE] R2 not configured — using /tmp. Set R2_* env vars for production storage.')
  }
  return configured
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

// ── Archivos genéricos (PDF/imagen) — usado por documentos médicos ──────
// A diferencia de savePdf, no arma la URL pública: el caller decide cómo
// exponer el archivo (acá se sirve vía una ruta autenticada propia, no un
// link público — son documentos confidenciales, LFPDPPP Art. 8).

function localFilePath(key: string, bucketSuffix: string): string {
  const dir = path.join(os.tmpdir(), 'codice-files', bucketSuffix, path.dirname(key))
  return path.join(dir, path.basename(key))
}

export async function saveFile(key: string, buffer: Buffer, contentType: string, bucketSuffix = 'files'): Promise<void> {
  if (r2Configured()) {
    const bucket = `${process.env.R2_BUCKET_PREFIX || 'codice-dev'}-${bucketSuffix}`
    await getS3().send(new PutObjectCommand({
      Bucket: bucket, Key: key, Body: buffer, ContentType: contentType,
    }))
    return
  }
  const filePath = localFilePath(key, bucketSuffix)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, buffer)
}

export async function readFile(key: string, bucketSuffix = 'files'): Promise<{ buffer: Buffer; contentType?: string }> {
  if (r2Configured()) {
    const bucket = `${process.env.R2_BUCKET_PREFIX || 'codice-dev'}-${bucketSuffix}`
    const obj = await getS3().send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    const buffer = Buffer.from(await obj.Body!.transformToByteArray())
    return { buffer, contentType: obj.ContentType }
  }
  return { buffer: fs.readFileSync(localFilePath(key, bucketSuffix)) }
}

export async function deleteFile(key: string, bucketSuffix = 'files'): Promise<void> {
  if (r2Configured()) {
    const bucket = `${process.env.R2_BUCKET_PREFIX || 'codice-dev'}-${bucketSuffix}`
    await getS3().send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => {})
    return
  }
  fs.rmSync(localFilePath(key, bucketSuffix), { force: true })
}

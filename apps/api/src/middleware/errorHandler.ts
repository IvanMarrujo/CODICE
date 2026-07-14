import { Request, Response, NextFunction } from 'express'
import { AppError } from '../lib/errors'
export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  if (err instanceof AppError) return res.status(err.statusCode).json({ error: err.message })
  if (err.name === 'ZodError') return res.status(400).json({ error: 'Datos inválidos', details: err.errors })
  console.error('[API ERROR]', err)
  res.status(500).json({ error: 'Error interno del servidor' })
}

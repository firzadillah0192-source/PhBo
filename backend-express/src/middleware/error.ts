import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import multer from 'multer';
import { AppError, errorMessage } from '../lib/errors.js';

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof ZodError) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: error.issues.map(({ path, message }) => ({ path, message })) } });
  if (error instanceof multer.MulterError) return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: { code: error.code, message: error.message } });
  if (error instanceof Error && 'type' in error && error.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Invalid JSON body' } });
  if (error instanceof Error && 'type' in error && error.type === 'entity.too.large') return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' } });
  if (error instanceof AppError) return res.status(error.status).json({ error: { code: error.code, message: error.message } });
  console.error('Request failed:', errorMessage(error));
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
}

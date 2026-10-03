import type { RequestHandler } from 'express';
import type { services } from '../container.js';

export type HttpHandler = RequestHandler<Record<string, string>, unknown, unknown>;
export type AppServices = typeof services;

declare global {
  namespace Express {
    interface Request {
      browserId?: string | null;
    }
  }
}

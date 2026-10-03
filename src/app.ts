import type { AppServices } from './types/http.js';
import type { ApiConfig } from './config/env.js';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { routes } from './routes/index.js';
import { originGuard } from './middleware/auth.js';
import { errorHandler } from './middleware/error.js';

export function createApp(services: AppServices, config: ApiConfig) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.CORS_ORIGINS, credentials: true }));
  app.use(originGuard(config.CORS_ORIGINS));
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/v1', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }, routes(services, config));
  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));
  app.use(errorHandler);
  return app;
}

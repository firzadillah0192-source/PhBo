import type { AppServices } from '../types/http.js';
import type { ApiConfig } from '../config/env.js';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { apiKey, browserAuth } from '../middleware/auth.js';
import { imageUpload, photoUpload } from '../middleware/upload.js';
import { frameController } from '../controllers/frame.controller.js';
import { photoSessionController } from '../controllers/photo-session.controller.js';
import { photoController } from '../controllers/photo.controller.js';
import { generationController } from '../controllers/generation.controller.js';

export function routes(services: AppServices, config: ApiConfig) {
  const router = Router();
  const upload = imageUpload(config.UPLOAD_MAX_MB);
  const admin = apiKey(config.ADMIN_API_KEY);
  const kiosk = apiKey(config.KIOSK_API_KEY);
  const browser = browserAuth(services.browsers);
  const frames = frameController(services.frames);
  const sessions = photoSessionController(services.sessions, config);
  const photos = photoController(services.photos);
  const generations = generationController(services.generations);
  const limit = (max: number) => rateLimit({ windowMs: 60000, limit: max, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests; retry later' } } });

  router.get('/frames', frames.list);
  router.get(['/frames/:id', '/frame/:id'], frames.get);
  router.post(['/frames', '/frame'], admin, limit(30), upload, frames.create);
  router.patch(['/frames/:id', '/frame/:id'], admin, frames.update);
  router.delete(['/frames/:id', '/frame/:id'], admin, frames.remove);
  router.post(['/photo-sessions', '/upload-image'], kiosk, limit(60), photoUpload(config.UPLOAD_MAX_MB), sessions.create);
  router.post('/photo-sessions/:code/claim', limit(20), browserAuth(services.browsers, true), sessions.claim);
  router.get('/photo-sessions/:code', browser, sessions.get);
  router.get(['/photos/:code', '/image/:code'], browser, photos.get);
  router.post('/generations', browser, limit(30), generations.create);
  router.get('/experiences', (_req, res) => res.json({ data: services.generations.listExperiences() }));
  router.get('/generations/:id', browser, generations.get);
  router.get('/photo-sessions/:codeOrId/generations', browser, generations.list);
  return router;
}

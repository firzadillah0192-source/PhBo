import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import type { CustomerResultService } from '../services/customer-result.service.js';
import type { CustomerAccountService } from '../services/customer-account.service.js';
import { customerResultController } from '../controllers/customer-result.controller.js';
import type { NativeRateLimitService } from '../services/native-rate-limit.service.js';

const limit = (max: number) => rateLimit({ windowMs: 60000, max, standardHeaders: false, legacyHeaders: false,
  handler: (_req, res) => { res.set('Retry-After', '60').status(429).json({ detail: { error_code: 'RATE_LIMITED', message: 'Please try again shortly.' } }); } });

export function customerResultRoutes(service: CustomerResultService, accounts: CustomerAccountService, limiter?:NativeRateLimitService) {
  const router = Router();
  const controller = customerResultController(service, accounts);
  router.get('/results/:id', controller.metadata);
  router.get('/results/:id/image', controller.image);
  router.get('/results/:id/download', controller.download);
  router.delete('/results/:id', controller.delete);
  router.post('/results/:id/claim', controller.claim);
  router.get('/public/results/:token', limiter?.middleware('claim',120)||limit(120), controller.publicMetadata);
  router.get('/public/results/:token/image', limiter?.middleware('image',180)||limit(180), controller.publicImage);
  router.get('/public/results/:token/download', limiter?.middleware('download',60)||limit(60), controller.publicDownload);
  router.post('/kiosk/session', controller.kiosk);
  return router;
}

import express, { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { PaymentService } from '../services/payment.service.js';
import type { AdminAuthService } from '../services/admin-auth.service.js';
import { paymentId } from '../services/payment.service.js';

export function paymentRoutes(service: PaymentService) {
  const router = Router();
  router.post('/duitku/callback', express.urlencoded({ extended: false, limit: '16kb', parameterLimit: 40 }), async (req, res) => {
    await service.callback(req.body); res.status(200).type('text/plain').send('OK');
  });
  return router;
}
export function paymentAdminRoutes(auth: AdminAuthService, service: PaymentService) {
  const router = Router();
  router.use(async (req, res, next) => { const actor = await auth.resolve(req.cookies ?? {}, req.get('x-admin-token')); auth.requireRole(actor, 'operator'); res.locals.paymentActor = actor.actor_id; next(); });
  router.get('/config', (_req, res) => { res.json(service.settings()); });
  router.get('/', async (req, res) => { res.json(await service.list(req.query)); });
  router.get('/:id', async (req, res) => { res.json(await service.detail(paymentId.parse(req.params.id))); });
  const checkLimit = rateLimit({ windowMs: 60000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });
  router.post('/:id/refresh', checkLimit, async (req, res) => { res.json(await service.adminRefresh(paymentId.parse(req.params.id), res.locals.paymentActor)); });
  return router;
}

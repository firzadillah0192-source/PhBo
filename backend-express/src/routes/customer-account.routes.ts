import { Router } from 'express';
import type { CustomerAccountService } from '../services/customer-account.service.js';
import { customerAccountController } from '../controllers/customer-account.controller.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { AppError } from '../lib/errors.js';
import { rateLimit } from 'express-rate-limit';
export function customerAccountRoutes(service: CustomerAccountService) {
  const router = Router();
  const controller = customerAccountController(service);
  router.get('/usage', controller.usage);
  router.get('/me', controller.me);
  router.get('/center', controller.center);
  const paymentLimit = rateLimit({ windowMs: 60000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });
  router.post('/topups/checkout', paymentLimit, controller.checkout);
  router.post('/subscriptions/checkout', paymentLimit, async (req, res) => {
    const identity = await service.resolve(req.cookies ?? {}), account = service.requireAccount(identity);
    if (!service.subscriptions || !service.payments) throw new AppError(503, 'SUBSCRIPTION_CHECKOUT_UNAVAILABLE', 'Checkout subscription belum tersedia.');
    const input = z.object({ plan_code: z.enum(['starter', 'plus', 'pro', 'max']) }).strict().parse(req.body);
    res.json(await service.payments.checkoutV2(account, input, req.get('Idempotency-Key') ?? randomUUID()));
  });
  router.get('/topups', controller.payments);
  router.get('/topups/:id', controller.payment);
  router.post('/topups/:id/refresh', paymentLimit, controller.refreshPayment);
  router.post('/google', controller.google);
  router.post('/signup', controller.signup);
  router.post('/login', controller.login);
  router.post('/logout', controller.logout);
  router.patch('/profile', controller.profile);
  router.post('/sessions/revoke-all', controller.revokeAll);
  router.post('/sessions/:id/revoke', controller.revoke);
  return router;
}

import { Router } from 'express';
import type { CustomerAccountService } from '../services/customer-account.service.js';
import { customerAccountController } from '../controllers/customer-account.controller.js';
export function customerAccountRoutes(service: CustomerAccountService) {
  const router = Router();
  const controller = customerAccountController(service);
  router.get('/usage', controller.usage);
  router.get('/me', controller.me);
  router.get('/center', controller.center);
  router.post('/topups/checkout', controller.checkout);
  router.post('/google', controller.google);
  router.post('/signup', controller.signup);
  router.post('/login', controller.login);
  router.post('/logout', controller.logout);
  router.patch('/profile', controller.profile);
  router.post('/sessions/revoke-all', controller.revokeAll);
  router.post('/sessions/:id/revoke', controller.revoke);
  return router;
}

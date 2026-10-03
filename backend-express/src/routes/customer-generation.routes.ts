import { Router } from 'express';
import { customerGenerationController } from '../controllers/customer-generation.controller.js';
import type { CustomerGenerationService } from '../services/customer-generation.service.js';
import type { CustomerAccountService } from '../services/customer-account.service.js';

export function customerGenerationRoutes(service: CustomerGenerationService, accounts: CustomerAccountService) {
  const route = Router();
  const controller = customerGenerationController(service, accounts);
  route.post('/generations', controller.create);
  route.get('/generations/:id', controller.status);
  return route;
}

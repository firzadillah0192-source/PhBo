import { Router } from 'express';
import multer from 'multer';
import type { CustomerAccountService } from '../services/customer-account.service.js';
import type { CustomerUploadService } from '../services/customer-upload.service.js';
import { customerUploadController } from '../controllers/customer-upload.controller.js';
export function customerUploadRoutes(service: CustomerUploadService, accounts: CustomerAccountService, maxBytes: number) {
  const router = Router();
  const controller = customerUploadController(service, accounts);
  router.post('/uploads', multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes, files: 1, fields: 8 } }).single('file'), controller.create);
  router.get('/uploads/:id', controller.metadata);
  router.get('/uploads/:id/preview', controller.preview);
  return router;
}

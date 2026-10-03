import { Router } from 'express';
import type { CustomerCatalogService } from '../services/customer-catalog.service.js';
import { customerCatalogController } from '../controllers/customer-catalog.controller.js';

export function customerCatalogRoutes(service: CustomerCatalogService) {
  const router = Router();
  const controller = customerCatalogController(service);
  router.get('/templates', controller.templates);
  router.get('/templates/:id/preview', controller.templatePreview);
  router.get('/experiences', controller.experiences);
  router.get('/experiences/:id/thumbnail', controller.experienceThumbnail);
  router.get('/classic/layouts', controller.layouts);
  router.get('/classic/layouts/:id/preview', controller.classicPreview);
  router.get('/advanced/frame-styles', controller.styles);
  router.get('/advanced/ornaments', controller.ornaments);
  return router;
}

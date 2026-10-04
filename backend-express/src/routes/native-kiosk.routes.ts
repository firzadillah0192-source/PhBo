import { Router } from 'express';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import type { NativeKioskService } from '../services/native-kiosk.service.js';
import type { CustomerCatalogService } from '../services/customer-catalog.service.js';
import { nativeKioskController } from '../controllers/native-kiosk.controller.js';

export function nativeKioskRoutes(service: NativeKioskService, catalog: CustomerCatalogService, maxBytes: number) {
  const router = Router(), handlers = nativeKioskController(service,catalog);
  const limit = (maximum: number) => rateLimit({ windowMs: 60000,limit: maximum,standardHeaders: 'draft-8',legacyHeaders: false });
  const upload = multer({ storage: multer.memoryStorage(),limits: { fileSize: maxBytes,files: 4,fields: 1,parts: 5 } }).array('image',4);
  router.post(['/photo-sessions','/upload-image'],(req,_res,next) => { service.authorize(req.get('X-API-Key')); next(); },limit(30),upload,handlers.create);
  router.post('/photo-sessions/:code/claim',limit(20),handlers.claim);
  router.get('/photo-sessions/:code',handlers.session);
  router.get('/photos/:id',limit(120),handlers.photo);
  router.get('/image/:id',limit(120),handlers.imageMetadata);
  router.get('/photos/:id/url',limit(120),handlers.photoUrl);
  router.post('/generations',limit(30),handlers.generate);
  router.get('/generations/:id',limit(120),handlers.status);
  router.get('/photo-sessions/:code/generations',handlers.history);
  router.get('/frames',handlers.frames);
  router.get(['/frames/:id','/frame/:id'],handlers.frame);
  router.get('/templates',handlers.templates);
  router.get('/experiences',handlers.experiences);
  router.get('/frame-styles',handlers.styles);
  router.get('/ornaments',handlers.ornaments);
  router.get(['/results/:id/image','/results/:id/download'],limit(120),handlers.result);
  router.get('/results/:id',limit(120),handlers.resultMetadata);
  router.get('/results/:id/url',limit(120),handlers.resultUrl);
  router.post('/results/:id/claim',limit(20),handlers.resultClaim);
  return router;
}

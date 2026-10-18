import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import type { GenerationApiRoutesService } from '../services/generation-api-routes.service.js';
import type { AdminAuthService } from '../services/admin-auth.service.js';

export function generationApiRoutes(auth: AdminAuthService, service: GenerationApiRoutesService) {
  const router = Router();
  router.use(async (req, res, next) => { const actor = await auth.resolve(req.cookies ?? {}, req.get('x-admin-token')); auth.requireRole(actor, 'superadmin'); res.locals.routeActor = actor.actor_id; next(); });
  router.use(rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false }));
  router.get('/', async (_req, res) => { res.json({ routes: await service.list() }); });
  router.put('/:lane', async (req, res) => { res.json(await service.save(z.enum(['standard', 'fast']).parse(req.params.lane), req.body, res.locals.routeActor)); });
  return router;
}

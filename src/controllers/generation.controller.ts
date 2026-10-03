import type { HttpHandler } from '../types/http.js';
import type { GenerationService } from '../services/generation.service.js';
import { createGeneration, publicCode, requestKey, uuid } from '../objects/requests.js';
export const generationController = (service: GenerationService): Record<'create' | 'get' | 'list', HttpHandler> => ({
  create: async (req, res) => res.status(202).json({ data: await service.create(createGeneration.parse(req.body), requestKey.parse(req.get('idempotency-key')), req.browserId) }),
  get: async (req, res) => res.json({ data: await service.get(uuid.parse(req.params.id), req.browserId) }),
  list: async (req, res) => res.json({ data: await service.list(publicCode.or(uuid).parse(req.params.codeOrId), req.browserId) }),
});

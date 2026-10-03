import type { HttpHandler } from '../types/http.js';
import type { FrameService } from '../services/frame.service.js';
import { createFrame, updateFrame, uuid } from '../objects/requests.js';
export const frameController = (service: FrameService): Record<'list' | 'get' | 'create' | 'update' | 'remove', HttpHandler> => ({
  list: async (_req, res) => res.json({ data: await service.list() }),
  get: async (req, res) => res.json({ data: await service.get(uuid.parse(req.params.id)) }),
  create: async (req, res) => res.status(201).json({ data: await service.create(createFrame.parse(req.body), req.file) }),
  update: async (req, res) => res.json({ data: await service.update(uuid.parse(req.params.id), updateFrame.parse(req.body)) }),
  remove: async (req, res) => { await service.disable(uuid.parse(req.params.id)); res.sendStatus(204); },
});

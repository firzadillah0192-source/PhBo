import type { HttpHandler } from '../types/http.js';
import type { PhotoService } from '../services/photo.service.js';
import { publicCode } from '../objects/requests.js';
export const photoController = (service: PhotoService): Record<'get', HttpHandler> => ({
  get: async (req, res) => res.json({ data: await service.get(publicCode.parse(req.params.code), req.browserId) }),
});

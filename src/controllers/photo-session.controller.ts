import type { HttpHandler } from '../types/http.js';
import type { PhotoSessionService } from '../services/photo-session.service.js';
import type { ApiConfig } from '../config/env.js';
import { claimSession, publicCode, createPhotoSession } from '../objects/requests.js';
export const photoSessionController = (service: PhotoSessionService, config: Pick<ApiConfig, 'NODE_ENV'>): Record<'create' | 'get' | 'claim', HttpHandler> => ({
  create: async (req, res) => res.status(201).json({ data: await service.create(Array.isArray(req.files) ? req.files : req.file, createPhotoSession.parse(req.body ?? {}).event) }),
  get: async (req, res) => res.json({ data: await service.get(publicCode.parse(req.params.code), req.browserId) }),
  claim: async (req, res) => {
    const { token } = claimSession.parse(req.body);
    const result = await service.claim(publicCode.parse(req.params.code), token, req.browserId);
    if (result.browser) res.cookie('photo_session', result.browser.value, {
      httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'lax',
      path: '/api/v1', maxAge: result.browser.ttl * 1000,
    });
    res.json({ data: result.session });
  },
});

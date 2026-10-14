import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { pipeline } from 'node:stream/promises';
import type { NativeKioskService } from '../services/native-kiosk.service.js';
import type { DesktopUpdateService } from '../services/desktop-update.service.js';

// Same kiosk credentials as the other native kiosk routes (account bearer token, or the legacy shared key). The installer is not secret
// but must not be a public download of unreleased builds.
export function desktopUpdateRoutes(kiosk: NativeKioskService, updates: DesktopUpdateService) {
  const router = Router();
  const limit = (maximum: number) => rateLimit({ windowMs: 60000, limit: maximum, standardHeaders: 'draft-8', legacyHeaders: false });
  const auth: import('express').RequestHandler = async (req, _res, next) => { await kiosk.authorizeRequest(req.get('Authorization'), req.get('X-API-Key')); next(); };
  router.get('/desktop/update', auth, limit(30), async (req, res) => {
    res.json({ data: await updates.check(req.query.current) });
  });
  router.get('/desktop/update/download', auth, limit(6), async (req, res) => {
    const file = await updates.download();
    res.set({ 'Content-Type': 'application/octet-stream', 'Content-Length': String(file.size), 'Content-Disposition': `attachment; filename="${file.name}"` });
    await pipeline(file.stream, res);
  });
  return router;
}

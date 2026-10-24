import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { NativeKioskService } from '../services/native-kiosk.service.js';
import type { DesktopDiagnosticsService } from '../services/desktop-diagnostics.service.js';

// Same kiosk credentials as the other native kiosk routes. JSON only; the gateway caps the body at 32k.
export function desktopDiagnosticsRoutes(kiosk: NativeKioskService, diagnostics: DesktopDiagnosticsService) {
  const router = Router();
  router.post('/desktop/diagnostics', rateLimit({ windowMs: 60000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false }), async (req, res) => {
    const who = await kiosk.authorizeRequest(req.get('Authorization'), req.get('X-API-Key'));
    res.status(201).json({ data: await diagnostics.record(who?.email ?? null, req.body) });
  });
  return router;
}

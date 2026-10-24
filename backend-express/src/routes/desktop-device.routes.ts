import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { KioskDeviceService } from '../services/kiosk-device.service.js';

const limit = (maximum: number) => rateLimit({ windowMs: 60000, limit: maximum, standardHeaders: 'draft-8', legacyHeaders: false });

// Called by the desktop app (no credentials yet), mounted at /api/v1 behind the control gateway.
export function desktopDeviceApiRoutes(devices: KioskDeviceService) {
  const router = Router();
  router.post('/desktop/device/code', limit(10), (req, res) => {
    const input = z.object({ device_name: z.string().max(100).optional() }).strict().parse(req.body ?? {});
    res.status(201).json({ data: devices.start(input.device_name) });
  });
  router.post('/desktop/device/token', limit(60), (req, res) => {
    const input = z.object({ device_code: z.string().max(200) }).strict().parse(req.body ?? {});
    res.json({ data: devices.poll(input.device_code) });
  });
  return router;
}

// Called by the web activation page with the signed-in account cookie, mounted at /api/desktop-device.
export function desktopDeviceApproveRoutes(devices: KioskDeviceService) {
  const router = Router();
  const body = z.object({ user_code: z.string().max(20) }).strict();
  router.post('/lookup', limit(20), async (req, res) => { res.json({ data: await devices.lookup(req.cookies ?? {}, body.parse(req.body).user_code) }); });
  router.post('/approve', limit(20), async (req, res) => { res.json({ data: await devices.approve(req.cookies ?? {}, body.parse(req.body).user_code) }); });
  return router;
}

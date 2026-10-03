import type { HttpHandler } from '../types/http.js';
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { CustomerResultService } from '../services/customer-result.service.js';
import type { CustomerAccountService } from '../services/customer-account.service.js';
import { guestCookie, accountCookie, tokenHash } from '../services/customer-credentials.service.js';

const claimInput = z.object({ reuse_token: z.string().min(32).max(256).nullable().optional(), refresh: z.boolean().default(false), kiosk: z.boolean().default(false) }).strict();
const rendition = z.enum(['master', 'print']);
const extension = (mime: string) => ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mime] ?? 'bin');

export function customerResultController(service: CustomerResultService, accounts: CustomerAccountService): Record<string, HttpHandler> {
  const identity = async (req: Request, res: Response) => {
    const found = await accounts.resolve(req.cookies ?? {});
    if (found.clearAccount) res.clearCookie(accountCookie, { path: '/' });
    if (found.newGuest) res.cookie(guestCookie, found.newGuest, { path: '/', httpOnly: true, secure: accounts.config.cookieSecure, sameSite: 'lax', maxAge: 365 * 86400000 });
    return found;
  };
  const kiosk = (req: Request, res: Response, rotate = false) => {
    let raw = accounts.signer.unsign(req.cookies?.photobooth_kiosk_session);
    if (rotate || !raw || raw.length < 32) {
      raw = randomBytes(32).toString('base64url');
      res.cookie('photobooth_kiosk_session', accounts.signer.sign(raw), { path: '/', httpOnly: true, secure: accounts.config.cookieSecure, sameSite: 'lax', maxAge: 12 * 3600000 });
    }
    return tokenHash(raw);
  };
  return {
    metadata: async (req, res) => { res.json(service.metadata(await service.owned(req.params.id, await identity(req, res)))); },
    image: async (req, res) => { const found = await service.owned(req.params.id, await identity(req, res)); res.type(found.result.content_type).send(await service.bytes(found.result)); },
    download: async (req, res) => {
      const print = rendition.parse(req.query.rendition ?? 'master') === 'print';
      const found = await service.owned(req.params.id, await identity(req, res));
      const filename = print ? `nxbooth-${found.result.id}-2x6-300dpi.png` : `photobooth-${found.result.template_id}-${found.result.id}.${extension(found.result.content_type)}`;
      res.attachment(filename).type(print ? 'image/png' : found.result.content_type).send(await service.rendition(found, print));
    },
    delete: async (req, res) => { z.object({ confirm: z.literal(true) }).parse(req.body); res.json(await service.delete(req.params.id, await identity(req, res))); },
    claim: async (req, res) => {
      const input = claimInput.parse(req.body ?? {});
      res.json(await service.createClaim(req.params.id, await identity(req, res), { refresh: input.refresh, reuseToken: input.reuse_token, kioskSessionId: input.kiosk ? kiosk(req, res) : null }));
    },
    publicMetadata: async (req, res) => { res.json(await service.publicMetadata(req.params.token)); },
    publicImage: async (req, res) => { const found = await service.publicClaim(req.params.token); const bytes = await service.bytes(found.result, true); await service.touch(found, false); res.type(found.result.content_type).send(bytes); },
    publicDownload: async (req, res) => {
      const print = rendition.parse(req.query.rendition ?? 'master') === 'print';
      const found = await service.publicClaim(req.params.token);
      const bytes = await service.rendition(found, print, true);
      await service.touch(found, true);
      res.attachment(print ? 'nxbooth-2x6-300dpi.png' : `photobooth-result.${extension(found.result.content_type)}`).type(print ? 'image/png' : found.result.content_type).send(bytes);
    },
    kiosk: async (req, res) => {
      const rotate = z.enum(['true', 'false', '1', '0']).parse(req.query.new_run ?? 'false');
      kiosk(req, res, rotate === 'true' || rotate === '1');
      res.json({ active: true, reset_after_seconds: service.config.kioskResetSeconds ?? 90, claim_ttl_hours: service.config.claimHours });
    },
  };
}

import type { HttpHandler } from '../types/http.js';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { CustomerAccountService } from '../services/customer-account.service.js';
import { accountCookie, guestCookie, tokenHash } from '../services/customer-credentials.service.js';
import { AppError } from '../lib/errors.js';

const credentials = z.object({ email: z.string().min(3).max(320), password: z.string().min(8).max(256) });
const profile = z.object({ display_name: z.string().max(255).nullable().optional() });

export function customerAccountController(service: CustomerAccountService): Record<string, HttpHandler> {
  const cookie = (res: Response, name: string, value: string, days: number) => res.cookie(name, value, {
    path: '/', httpOnly: true, secure: service.config.cookieSecure, sameSite: 'lax', maxAge: days * 86400000,
  });
  const clear = (res: Response) => res.clearCookie(accountCookie, { path: '/', httpOnly: true, secure: service.config.cookieSecure, sameSite: 'lax' });
  const resolve = async (req: Request, res: Response) => {
    const identity = await service.resolve(req.cookies ?? {});
    if (identity.clearAccount) clear(res);
    if (identity.newGuest) cookie(res, guestCookie, identity.newGuest, 365);
    return identity;
  };
  return {
    usage: async (req, res) => { res.json(await service.usage(await resolve(req, res))); },
    me: async (req, res) => { const identity=await resolve(req,res);res.json({...await service.me(identity),analytics_id:identity.account?'phbo-account:'+identity.account.id:null}); },
    center: async (req, res) => { res.json(await service.center(await resolve(req, res))); },
    checkout: async (req, res) => {
      service.requireAccount(await resolve(req, res));
      z.object({ credits: z.number().int().positive().max(Math.floor(Number.MAX_SAFE_INTEGER / 100)) }).strict().parse(req.body);
      // Replace this unavailable boundary with a server-created gateway checkout.
      // Selection alone must never create a payment or grant wallet credits.
      throw new AppError(503, 'PAYMENT_GATEWAY_UNAVAILABLE', 'Pembayaran saat ini belum tersedia. Hubungi support@gennexbyte.com.');
    },
    google: async (req, res) => {
      const input = z.object({ id_token: z.string().min(20).max(16384) }).parse(req.body);
      const result = await service.google(input.id_token, req.cookies ?? {});
      cookie(res, accountCookie, result.cookie, service.config.sessionDays); res.clearCookie(guestCookie, { path: '/' }); res.json(result.account);
    },
    signup: async (req, res) => {
      const input = credentials.parse(req.body);
      const result = await service.signup(input.email, input.password, req.cookies ?? {});
      cookie(res, accountCookie, result.cookie, service.config.sessionDays);
      res.status(201).json(result.account);
    },
    login: async (req, res) => {
      const input = credentials.parse(req.body);
      const result = await service.login(input.email, input.password);
      cookie(res, accountCookie, result.cookie, service.config.sessionDays);
      res.json(result.account);
    },
    logout: async (req, res) => { const result = await service.logout(req.cookies ?? {}); clear(res); res.json(result); },
    profile: async (req, res) => { const input = profile.parse(req.body); res.json(await service.profile(await resolve(req, res), input.display_name ?? null)); },
    revokeAll: async (req, res) => { const result = await service.revokeAll(await resolve(req, res)); clear(res); res.json(result); },
    revoke: async (req, res) => {
      const result = await service.revoke(await resolve(req, res), req.params.id);
      const raw = service.signer.unsign(req.cookies?.[accountCookie]);
      const current = Boolean(raw && tokenHash(raw) === req.params.id);
      if (current) clear(res);
      res.json({ ...result, current });
    },
  };
}

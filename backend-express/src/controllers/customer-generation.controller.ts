import type { HttpHandler } from '../types/http.js';
import type { CustomerAccountService } from '../services/customer-account.service.js';
import type { CustomerGenerationService } from '../services/customer-generation.service.js';
import { accountCookie, guestCookie } from '../services/customer-credentials.service.js';
import type { Request, Response } from 'express';

export function customerGenerationController(service: CustomerGenerationService, accounts: CustomerAccountService): Record<string, HttpHandler> {
  const identity = async (req: Request, res: Response) => {
    const found = await accounts.resolve(req.cookies ?? {});
    if (found.clearAccount) res.clearCookie(accountCookie, { path: '/' });
    if (found.newGuest) res.cookie(guestCookie, found.newGuest, { path: '/', httpOnly: true, secure: accounts.config.cookieSecure, sameSite: 'lax', maxAge: 365 * 86400000 });
    return found;
  };
  return {
    create: async (req, res) => { res.status(202).json(await service.create(req.body, await identity(req, res))); },
    status: async (req, res) => { res.json(await service.status(req.params.id, await identity(req, res))); },
  };
}

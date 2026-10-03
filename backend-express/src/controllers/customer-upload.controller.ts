import type { HttpHandler } from '../types/http.js';
import type { CustomerAccountService } from '../services/customer-account.service.js';
import type { CustomerUploadService } from '../services/customer-upload.service.js';
import { accountCookie, guestCookie } from '../services/customer-credentials.service.js';
import type { Request, Response } from 'express';

export function customerUploadController(service: CustomerUploadService, accounts: CustomerAccountService): Record<string, HttpHandler> {
  const identity = async (req: Request, res: Response) => {
    const found = await accounts.resolve(req.cookies ?? {});
    if (found.clearAccount) res.clearCookie(accountCookie, { path: '/' });
    if (found.newGuest) res.cookie(guestCookie, found.newGuest, { path: '/', httpOnly: true, secure: accounts.config.cookieSecure, sameSite: 'lax', maxAge: 365 * 86400000 });
    return found;
  };
  return {
    create: async (req, res) => { res.status(201).json(await service.create(req.file, await identity(req, res))); },
    metadata: async (req, res) => { res.json(service.response((await service.owned(req.params.id, await identity(req, res))).upload)); },
    preview: async (req, res) => { const found = await service.owned(req.params.id, await identity(req, res)); res.type(found.upload.content_type).sendFile(found.path); },
  };
}

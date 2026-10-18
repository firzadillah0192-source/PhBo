import { Router } from 'express';
import { AppError } from '../lib/errors.js';
import type { CustomerAccountService } from '../services/customer-account.service.js';
import type { PublicApiKeyService } from '../services/public-api-key.service.js';

// Web-session (cookie) routes for people managing their own integration keys. API keys cannot call these.
export function publicApiKeyManagementRoutes(keys: PublicApiKeyService, accounts: Pick<CustomerAccountService, 'resolve'>) {
  const router = Router();
  const accountId = async (cookies: Record<string, unknown> | undefined) => {
    const found = await accounts.resolve(cookies ?? {});
    if (!found.account) throw new AppError(401, 'AUTH_REQUIRED', 'Sign in to manage API keys.');
    return found.account.id;
  };
  router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  router.get('/', async (req, res) => { res.json(await keys.list(await accountId(req.cookies))); });
  router.post('/', async (req, res) => { res.status(201).json(await keys.create(await accountId(req.cookies), req.body)); });
  router.post('/:id/rotate', async (req, res) => { res.status(201).json(await keys.rotate(await accountId(req.cookies), req.params.id)); });
  router.post('/:id/revoke', async (req, res) => { res.json(await keys.revoke(await accountId(req.cookies), req.params.id)); });
  return router;
}

import type { HttpHandler } from '../types/http.js';
import type { BrowserSessionService } from '../services/browser-session.service.js';
import { equal } from '../lib/tokens.js';
import { ensure } from '../lib/errors.js';

export const apiKey = (expected: string): HttpHandler => (req, _res, next) => {
  ensure(equal(req.get('x-api-key'), expected), 401, 'UNAUTHORIZED', 'Valid X-API-Key required');
  next();
};
export const browserAuth = (browsers: Pick<BrowserSessionService, 'get'>, optional = false): HttpHandler => async (req, _res, next) => {
  const bearer = req.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  const credential = bearer ?? req.cookies?.photo_session;
  req.browserId = await browsers.get(typeof credential === 'string' && credential.length === 43 ? credential : null);
  if (!optional) ensure(req.browserId, 401, 'BROWSER_SESSION_REQUIRED', 'Claim the QR before accessing this resource');
  next();
};
export const originGuard = (origins: string[]): HttpHandler => (req, _res, next) => {
  const origin = req.get('origin');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && origin) {
    ensure(origins.includes(origin), 403, 'ORIGIN_FORBIDDEN', 'Origin is not allowed');
  }
  next();
};

import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import type { AdminAuthModel } from '../models/admin-auth.model.js';
import type { CustomerCookieSigner } from './customer-credentials.service.js';
import { AppError } from '../lib/errors.js';
export const adminCookie = 'photobooth_admin';
export type AdminPrincipal = { actor_id: string; role: string };
const roles = new Set(['superadmin', 'operator', 'content_manager']);
function equal(a: string, b: string) { return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest()); }
export class AdminAuthService {
  constructor(private readonly model: AdminAuthModel, readonly signer: CustomerCookieSigner,
    readonly config: { token: string; defaultRole: string; sessionDays: number; cookieSecure: boolean }) {}
  async login(token: string) {
    const expected = this.config.token.trim();
    if (!expected) throw new AppError(404, 'ADMIN_DISABLED', 'Admin API is disabled');
    if (!token || !equal(token, expected)) throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid admin credentials.');
    const raw = randomBytes(48).toString('base64url');
    await this.model.login(raw, roles.has(this.config.defaultRole) ? this.config.defaultRole : 'superadmin', new Date(Date.now() + this.config.sessionDays * 86400000));
    return this.signer.sign(raw);
  }
  async resolve(cookies: Record<string, unknown>, header?: string): Promise<AdminPrincipal> {
    const raw = this.signer.unsign(cookies[adminCookie]);
    if (raw) {
      const session = await this.model.session(raw);
      if (session?.is_admin && session.expires_at > new Date()) {
        const role = (session.admin_role || 'superadmin').toLowerCase();
        const actor = session.admin_user_id ? await this.model.actor(session.admin_user_id) : null;
        if (roles.has(role) && (!session.admin_user_id || actor?.is_active)) return { actor_id: session.admin_user_id || 'admin', role: actor?.role || role };
      }
    }
    if (header && this.config.token.trim() && equal(header, this.config.token.trim())) return { actor_id: 'token-admin', role: 'superadmin' };
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Admin authentication required.');
  }
  requireRole(principal: AdminPrincipal, role: string) {
    if (principal.role !== 'superadmin' && principal.role !== role) throw new AppError(403, 'ADMIN_FORBIDDEN', 'Your admin role cannot perform this action.');
  }
  async logout(cookies: Record<string, unknown>) { const raw = this.signer.unsign(cookies[adminCookie]); if (raw) await this.model.logout(raw); }
}

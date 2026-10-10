import { randomBytes } from 'node:crypto';
import type { AdminAuthModel } from '../models/admin-auth.model.js';
import { accountCookie, verifyCustomerPassword, type CustomerCookieSigner } from './customer-credentials.service.js';
import { AppError } from '../lib/errors.js';
export const adminCookie = 'photobooth_admin';
export type AdminPrincipal = { actor_id: string; role: string };
const roles = new Set(['superadmin', 'operator', 'content_manager']);
export class AdminAuthService {
  constructor(private readonly model: AdminAuthModel, readonly signer: CustomerCookieSigner,
    readonly config: { token: string; defaultRole: string; sessionDays: number; cookieSecure: boolean }) {}
  async login(credentials: { email: string; password: string } | null, cookies: Record<string, unknown> = {}) {
    let email: string;
    if (credentials) {
      email = credentials.email.trim().toLowerCase();
      const account = await this.model.account(email);
      if (!account || !await verifyCustomerPassword(credentials.password, account.password_hash)) {
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
      }
    } else {
      const raw = this.signer.unsign(cookies[accountCookie]);
      const session = raw ? await this.model.session(raw) : null;
      if (!session?.account_id || session.is_admin || session.expires_at <= new Date()) {
        throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Sign in with your NXBooth account.');
      }
      const account = await this.model.accountById(session.account_id);
      if (!account) throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Sign in with your NXBooth account.');
      email = account.email;
    }
    const account = await this.model.account(email);
    const actor = await this.model.actorForEmail(email);
    if (!account || account.status !== 'active' || !actor || !roles.has(actor.role)) {
      throw new AppError(403, 'ADMIN_FORBIDDEN', 'This account does not have active admin access.');
    }
    const raw = randomBytes(48).toString('base64url');
    await this.model.login(raw, actor.id, account.id, new Date(Date.now() + this.config.sessionDays * 86400000));
    return this.signer.sign(raw);
  }
  async resolve(cookies: Record<string, unknown>, _legacyHeader?: string): Promise<AdminPrincipal> {
    const raw = this.signer.unsign(cookies[adminCookie]);
    if (raw) {
      const session = await this.model.session(raw);
      if (session?.is_admin && session.admin_user_id && session.account_id && session.expires_at > new Date()) {
        const actor = await this.model.actor(session.admin_user_id);
        const account = actor?.email ? await this.model.account(actor.email.trim().toLowerCase()) : null;
        if (actor?.is_active && roles.has(actor.role) && account?.status === 'active' && account.id === session.account_id) return { actor_id: actor.id, role: actor.role };
      }
    }
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Admin sign-in required.');
  }
  requireRole(principal: AdminPrincipal, role: string) {
    if (principal.role !== 'superadmin' && principal.role !== role) throw new AppError(403, 'ADMIN_FORBIDDEN', 'Your admin role cannot perform this action.');
  }
  async logout(cookies: Record<string, unknown>) { const raw = this.signer.unsign(cookies[adminCookie]); if (raw) await this.model.logout(raw); }
}

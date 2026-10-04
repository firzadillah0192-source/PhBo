import { randomBytes } from 'node:crypto';
import type { NxAccount, NxGuestSession } from '@prisma/client';
import type { CustomerAccountModel } from '../models/customer-account.model.js';
import { AppError } from '../lib/errors.js';
import { accountCookie, guestCookie, CustomerCookieSigner, hashCustomerPassword, verifyCustomerPassword } from './customer-credentials.service.js';
import type { GoogleVerifier } from './google-identity.service.js';
import type { CatalogAssetsService } from './catalog-assets.service.js';
import type { NxPlan, NxSubscription } from '@prisma/client';

export type CustomerIdentity = { account: NxAccount | null; guest: NxGuestSession | null; clearAccount: boolean; newGuest: string | null; sessionId: string };
type Identity = CustomerIdentity;
export type AccountConfig = { sessionDays: number; cookieSecure: boolean; sessionSecret: string };
export class CustomerAccountService {
  readonly signer: CustomerCookieSigner;
  constructor(private readonly model: CustomerAccountModel, readonly config: AccountConfig, private readonly googleVerifier?: GoogleVerifier, private readonly assets?: CatalogAssetsService) { this.signer = new CustomerCookieSigner(config.sessionSecret); }

  async resolve(cookies: Record<string, unknown>): Promise<Identity> {
    const raw = this.signer.unsign(cookies[accountCookie]);
    if (raw) {
      const session = await this.model.session(raw);
      if (session?.account_id && session.expires_at > new Date()) {
        const account = await this.model.account(session.account_id);
        if (account && account.status !== 'suspended') return { account, guest: null, clearAccount: false, newGuest: null, sessionId: session.id };
      }
    }
    const guestId = this.signer.unsign(cookies[guestCookie]);
    const guest = guestId ? await this.model.guest(guestId) : null;
    if (guest) return { account: null, guest, clearAccount: Boolean(raw), newGuest: null, sessionId: guest.id };
    const id = randomBytes(32).toString('hex');
    return { account: null, guest: await this.model.createGuest(id), clearAccount: Boolean(raw), newGuest: this.signer.sign(id), sessionId: id };
  }

  response(account: NxAccount | null, provider: string | null = null) {
    return { authenticated: Boolean(account), email: account?.email ?? null, display_name: account?.display_name ?? null,
      avatar_url: account?.avatar_url ?? null, provider, created_at: account?.created_at ?? null };
  }
  async me(identity: Identity) { return this.response(identity.account, identity.account ? await this.model.provider(identity.account.id) : null); }
  usage(identity: Identity) {
    const owner = identity.account ?? identity.guest;
    if (!owner) throw new AppError(500, 'IDENTITY_UNAVAILABLE', 'Identity unavailable');
    return { authenticated: Boolean(identity.account), quota_type: identity.account ? 'account' : 'guest', ai_total: owner.ai_quota_total,
      ai_used: owner.ai_quota_used, ai_reserved: owner.ai_quota_reserved, ai_remaining: Math.max(0, owner.ai_quota_total - owner.ai_quota_used - owner.ai_quota_reserved) };
  }
  async signup(email: string, password: string, cookies: Record<string, unknown>) {
    email = email.trim().toLowerCase();
    if (!email.includes('@') || email.startsWith('@') || email.endsWith('@')) throw new AppError(422, 'VALIDATION_FAILED', 'Enter a valid email address.');
    if (await this.model.byEmail(email)) throw new AppError(409, 'ACCOUNT_EXISTS', 'An account with this email already exists.');
    let account;
    try { account = await this.model.signup(email, await hashCustomerPassword(password), this.signer.unsign(cookies[guestCookie])); }
    catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') throw new AppError(409, 'ACCOUNT_EXISTS', 'An account with this email already exists.');
      throw error;
    }
    return this.start(account);
  }
  async login(email: string, password: string) {
    const account = await this.model.byEmail(email.trim().toLowerCase());
    if (!account || !await verifyCustomerPassword(password, account.password_hash)) throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    if (account.status === 'suspended') throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended.');
    return this.start(account);
  }
  private async start(account: NxAccount, provider = 'password') {
    const raw = randomBytes(48).toString('base64url');
    await this.model.startSession(account.id, raw, new Date(Date.now() + this.config.sessionDays * 86400000));
    return { account: this.response(account, provider), cookie: this.signer.sign(raw) };
  }
  async logout(cookies: Record<string, unknown>) {
    const raw = this.signer.unsign(cookies[accountCookie]);
    if (raw) await this.model.logout(raw);
    return this.response(null);
  }
  requireAccount(identity: Identity) {
    if (!identity.account) throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Sign in to use this account action.');
    return identity.account;
  }
  async profile(identity: Identity, name: string | null) {
    const account = await this.model.profile(this.requireAccount(identity).id, name?.trim() || null);
    return this.response(account, await this.model.provider(account.id));
  }
  async revokeAll(identity: Identity) { return { revoked_sessions: (await this.model.revokeAll(this.requireAccount(identity).id)).count }; }
  async revoke(identity: Identity, id: string) {
    if (!(await this.model.revoke(this.requireAccount(identity).id, id)).count) throw new AppError(404, 'SESSION_NOT_FOUND', 'That session is no longer active.');
    return { revoked: true };
  }
  async google(token: string, cookies: Record<string, unknown>) {
    if (!this.googleVerifier) throw new AppError(503, 'GOOGLE_AUTH_UNAVAILABLE', 'Google sign-in is unavailable.');
    const claims = await this.googleVerifier.verify(token);
    const account = await this.model.google(claims, await hashCustomerPassword(`google-unusable-${randomBytes(32).toString('base64url')}`), this.signer.unsign(cookies[guestCookie]));
    return this.start(account, 'google');
  }
  async center(identity: Identity) {
    const account = this.requireAccount(identity);
    const data = await this.model.center(account.id);
    const planResponse = (plan: NxPlan | null, subscription: NxSubscription | null = null) => plan ? {
      id: plan.id, code: plan.code, name: plan.name, description: plan.description, monthly_ai_credits: plan.monthly_ai_credits || null,
      billing_period: plan.billing_period, is_active: plan.is_active, status: subscription?.status ?? null,
      current_period_start: subscription?.current_period_start ?? null, current_period_end: subscription?.current_period_end ?? null, cancel_at_period_end: subscription?.cancel_at_period_end ?? false,
    } : { id: 'free', code: 'free', name: 'Free', description: 'Try the product', monthly_ai_credits: null, billing_period: null, is_active: true, status: 'active', current_period_start: null, current_period_end: null, cancel_at_period_end: false };
    const creations = [];
    for (const job of data.jobs) {
      const result = await this.model.creationResult(job.id);
      const experience = job.experience_id ? await this.model.creationExperience(job.experience_id) : null;
      const template = job.template_id ? await this.model.creationTemplate(job.template_id) : null;
      const available = result && !result.deleted_at && this.assets ? await this.assets.exists(result.storage_path) : false;
      creations.push({ result_id: result?.id ?? null, id: result?.id ?? job.id, job_id: job.id, mode: job.mode,
        title: experience?.name || template?.name || job.experience_id || job.template_id || 'Photobooth creation', status: job.state,
        experience_id: job.experience_id, template_id: job.template_id || null, image_url: available ? `/api/results/${result!.id}/image` : null,
        download_url: available ? `/api/results/${result!.id}/download` : null, created_at: job.created_at, expired: Boolean(job.state === 'COMPLETED' && result && !available) });
    }
    return { account: await this.me(identity), usage: { ...this.usage(identity), used_this_period: Math.abs(data.spent) }, current_plan: planResponse(data.plan, data.subscription), plans: data.plans.map(plan => planResponse(plan)), creations,
      sessions: data.sessions.map(session => ({ id: session.id, created_at: session.created_at, last_seen_at: session.last_seen_at, expires_at: session.expires_at, active: session.expires_at > new Date(), is_current: session.id === identity.sessionId })),
      billing: { enabled: false, message: 'Billing will become available when paid plans launch.', payment_method_available: false, invoices_available: false },
      privacy: { creation_deletion_available: true, retention_configured: false, retention_message: 'Generated result photos can be deleted from My Creations. Automatic retention is not configured.', export_available: false, deletion_available: false } };
  }
}

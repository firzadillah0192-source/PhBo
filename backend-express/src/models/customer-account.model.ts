import type { PrismaClient } from '@prisma/client';
import { legacyId, tokenHash } from '../services/customer-credentials.service.js';
import type { GoogleClaims } from '../services/google-identity.service.js';
import { CreditWalletModel } from './credit-wallet.model.js';
import { AppError } from '../lib/errors.js';

export class CustomerAccountModel {
  constructor(private readonly db: PrismaClient) {}
  async account(id: string) { const account = await this.db.nxAccount.findUnique({ where: { id } }); if (!account) return null; await this.wallet(id); return this.db.nxAccount.findUnique({ where: { id } }); }
  wallet(id: string) { return new CreditWalletModel(this.db).snapshot(id); }
  async byEmail(email: string) { return this.db.nxAccount.findUnique({ where: { email } }); }
  async guest(id: string) { return this.db.nxGuestSession.findUnique({ where: { id } }); }
  async createGuest(id: string) { return this.db.nxGuestSession.create({ data: { id } }); }
  async session(raw: string) { return this.db.nxAuthSession.findUnique({ where: { id: tokenHash(raw) } }); }
  async provider(account_id: string) { return (await this.db.nxAuthIdentity.findFirst({ where: { account_id }, orderBy: { created_at: 'asc' } }))?.provider ?? 'password'; }

  async signup(email: string, password_hash: string, guest_id: string | null) {
    return this.db.$transaction(async tx => {
      const account = await tx.nxAccount.create({ data: { id: legacyId(), email, password_hash, ai_quota_total: 0 } });
      await new CreditWalletModel(this.db).ensureIn(tx, account.id);
      if (guest_id) {
        await tx.nxUpload.updateMany({ where: { guest_id }, data: { account_id: account.id, guest_id: null } });
        await tx.nxGenerationJob.updateMany({ where: { guest_id }, data: { account_id: account.id, guest_id: null } });
      }
      return account;
    });
  }

  async startSession(account_id: string, raw: string, expires_at: Date) {
    const now = new Date();
    return this.db.$transaction(async tx => {
      await tx.nxAccount.update({ where: { id: account_id }, data: { last_login_at: now, last_activity_at: now } });
      return tx.nxAuthSession.create({ data: { id: tokenHash(raw), account_id, expires_at } });
    });
  }
  async logout(raw: string) { return this.db.nxAuthSession.deleteMany({ where: { id: tokenHash(raw), is_admin: false } }); }
  async profile(id: string, display_name: string | null) { return this.db.nxAccount.update({ where: { id }, data: { display_name, updated_at: new Date() } }); }
  async revokeAll(account_id: string) { return this.db.nxAuthSession.deleteMany({ where: { account_id, is_admin: false } }); }
  async revoke(account_id: string, id: string) { return this.db.nxAuthSession.deleteMany({ where: { id, account_id, is_admin: false } }); }
  async google(claims: GoogleClaims, password_hash: string, guest_id: string | null) {
    return this.db.$transaction(async tx => {
      // Serialize identity linking and account/signup grant for concurrent login.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`google:${claims.subject}`},0))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`email:${claims.email}`},0))`;
      let identity = await tx.nxAuthIdentity.findUnique({ where: { provider_provider_subject: { provider: 'google', provider_subject: claims.subject } } });
      let account = identity ? await tx.nxAccount.findUnique({ where: { id: identity.account_id } }) : await tx.nxAccount.findUnique({ where: { email: claims.email } });
      if (identity && !account) throw new AppError(409, 'AUTH_IDENTITY_ORPHANED', 'Google identity is not linked to an account.');
      if (!account) {
        account = await tx.nxAccount.create({ data: { id: legacyId(), email: claims.email, password_hash, ai_quota_total: 0, display_name: claims.name, avatar_url: claims.avatar_url } });
        await new CreditWalletModel(this.db).ensureIn(tx, account.id);
      }
      if (account.status === 'suspended') throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended.');
      if (!identity) identity = await tx.nxAuthIdentity.create({ data: { id: legacyId(), account_id: account.id, provider: 'google', provider_subject: claims.subject, email: claims.email } });
      await tx.nxAuthIdentity.update({ where: { id: identity.id }, data: { email: claims.email, last_login_at: new Date() } });
      account = await tx.nxAccount.update({ where: { id: account.id }, data: {
        ...(claims.name ? { display_name: claims.name } : {}), ...(claims.avatar_url ? { avatar_url: claims.avatar_url } : {}), updated_at: new Date(),
      } });
      if (guest_id) {
        await tx.nxUpload.updateMany({ where: { guest_id }, data: { account_id: account.id, guest_id: null } });
        await tx.nxGenerationJob.updateMany({ where: { guest_id }, data: { account_id: account.id, guest_id: null } });
      }
      return account;
    });
  }
  async center(account_id: string) {
    const subscription = await this.db.nxSubscription.findFirst({ where: { user_id: account_id, status: 'active' }, orderBy: { created_at: 'desc' } });
    const plan = subscription ? await this.db.nxPlan.findUnique({ where: { id: subscription.plan_id } }) : null;
    const ids = await this.db.$queryRaw<{ id: string }[]>`SELECT j.id FROM generation_jobs j LEFT JOIN results r ON r.job_id=j.id
      WHERE j.account_id=${account_id} AND (r.id IS NULL OR r.deleted_at IS NULL) ORDER BY j.created_at DESC LIMIT 100`;
    return { subscription, plan, plans: await this.db.nxPlan.findMany({ where: { is_active: true }, orderBy: { created_at: 'asc' } }),
      sessions: await this.db.nxAuthSession.findMany({ where: { account_id, is_admin: false }, orderBy: { created_at: 'desc' }, take: 20 }),
      jobs: await this.db.nxGenerationJob.findMany({ where: { id: { in: ids.map(item => item.id) } }, orderBy: { created_at: 'desc' } }),
      spent: (await this.db.nxCreditLedger.aggregate({ where: { user_id: account_id, type: 'generation_spend', created_at: { gte: subscription?.current_period_start ?? (await this.account(account_id))!.created_at } }, _sum: { amount: true } }))._sum.amount ?? 0 };
  }
  async creationBilling(job_id: string) {
    const [row] = await this.db.$queryRaw<{ status: string; credits: number | null }[]>`SELECT status,credits FROM generation_credit_charges WHERE job_id=${job_id}`;
    return row ?? null;
  }
  async creationResult(job_id: string) {
    const result = await this.db.nxResult.findUnique({ where: { job_id } });
    if (!result) return null;
    const [scope] = await this.db.$queryRaw<{ kiosk_session_id: string | null }[]>`SELECT kiosk_session_id FROM generation_jobs WHERE id=${job_id}`;
    return { ...result, kiosk: Boolean(scope?.kiosk_session_id) };
  }
  creationExperience(id: string) { return this.db.nxExperience.findUnique({ where: { id } }); }
  creationTemplate(id: string) { return this.db.nxTemplate.findUnique({ where: { id } }); }
}

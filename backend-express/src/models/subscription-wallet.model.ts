import type { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../lib/errors.js';
import { subscriptionPlan, subscriptionCatalog, freeCalendarPeriod, jakartaDay, creditAllocation, fixedGenerationPrice, hasStorageCapacity, subscriptionResultExpiry, type PlanCode } from '../services/subscription-policy.service.js';

type Tx = Prisma.TransactionClient;
export type SubscriptionOwner = { account_id: string | null; guest_id: string | null };
type Wallet = SubscriptionOwner & { owner_scope: string; plan_code: PlanCode; subscription_id: string | null; period_start: Date; period_end: Date; ai_monthly: number; ai_top_up: number; classic_monthly: number; classic_top_up: number; legacy_converted: number };
type Charge = { job_id: string; owner_scope: string; lane: 'classic' | 'standard' | 'fast'; currency: 'AI' | 'CLASSIC'; credits: number; monthly_part: number; top_up_part: number; period_start: Date; retention_days: number; status: string };
export const RESULT_CAPACITY_RESERVATION = 25 * 1024 * 1024;

export class SubscriptionWalletModel {
  constructor(private readonly db: PrismaClient, private readonly clock: () => Date = () => new Date()) {}
  private scope(owner: SubscriptionOwner) {
    if (Boolean(owner.account_id) === Boolean(owner.guest_id)) throw new AppError(401, 'IDENTITY_UNAVAILABLE', 'Identitas pengguna tidak tersedia.');
    return owner.account_id ? `account:${owner.account_id}` : `guest:${owner.guest_id}`;
  }
  private async ledger(tx: Tx, scope: string, currency: 'AI' | 'CLASSIC', amount: number, reason: string, key: string) {
    await tx.$executeRaw`INSERT INTO subscription_v2_ledger(owner_scope,currency,amount,reason,idempotency_key) VALUES(${scope},${currency},${amount},${reason},${key}) ON CONFLICT(idempotency_key) DO NOTHING`;
  }
  async ensureIn(tx: Tx, owner: SubscriptionOwner): Promise<Wallet> {
    const scope = this.scope(owner), now = this.clock();
    // All operations for one owner use this same lock before wallet/job locks.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scope},240))::text`;
    if (owner.account_id) await tx.$queryRaw`SELECT id FROM accounts WHERE id=${owner.account_id} FOR UPDATE`;
    else await tx.$queryRaw`SELECT id FROM guest_sessions WHERE id=${owner.guest_id} FOR UPDATE`;
    const subscriptions = owner.account_id ? await tx.$queryRaw<{ id: string; code: string; current_period_start: Date; current_period_end: Date }[]>`SELECT s.id,p.code,s.current_period_start,s.current_period_end FROM subscriptions s JOIN subscription_plans p ON p.id=s.plan_id
      WHERE s.user_id=${owner.account_id} AND (s.status='active' OR (s.status='cancelled' AND s.cancel_at_period_end=true)) AND s.current_period_start<=${now} AND s.current_period_end>${now} AND p.code IN ('v2_starter','v2_plus','v2_pro','v2_max') ORDER BY s.created_at DESC LIMIT 1` : [];
    const subscription = subscriptions[0], plan = subscriptionPlan(subscription ? subscription.code.slice(3) : 'free');
    const free = freeCalendarPeriod(now), start = subscription?.current_period_start ?? free.start, end = subscription?.current_period_end ?? free.end;
    let [wallet] = await tx.$queryRaw<Wallet[]>`SELECT * FROM subscription_v2_wallets WHERE owner_scope=${scope} FOR UPDATE`;
    if (!wallet) {
      let converted = 0;
      if (owner.account_id) {
        const [pending] = await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM generation_jobs j JOIN quota_reservations q ON q.job_id=j.id WHERE j.account_id=${owner.account_id} AND q.status='RESERVED'`;
        if (pending?.n) throw new AppError(409, 'LEGACY_GENERATION_PENDING', 'Selesaikan generate atau pembayaran hasil sebelumnya sebelum konversi saldo.');
        const [legacy] = await tx.$queryRaw<{ balance: number }[]>`SELECT GREATEST(0,a.ai_quota_total-a.ai_quota_used-a.ai_quota_reserved-COALESCE(w.free_remaining,0))::int AS balance FROM accounts a LEFT JOIN credit_wallets w ON w.account_id=a.id WHERE a.id=${owner.account_id}`;
        converted = (legacy?.balance ?? 0) * 10;
        if (!Number.isSafeInteger(converted) || converted > 2_147_483_647) throw new AppError(409, 'LEGACY_BALANCE_REVIEW_REQUIRED', 'Saldo lama perlu diperiksa sebelum konversi.');
      }
      [wallet] = await tx.$queryRaw<Wallet[]>`INSERT INTO subscription_v2_wallets(owner_scope,account_id,guest_id,plan_code,subscription_id,period_start,period_end,ai_monthly,ai_top_up,classic_monthly,legacy_converted)
        VALUES(${scope},${owner.account_id},${owner.guest_id},${plan.code},${subscription?.id ?? null},${start},${end},${plan.monthly_ai_credits},${converted},${plan.monthly_classic_credits},${converted}) RETURNING *`;
      await this.ledger(tx, scope, 'AI', converted, 'Legacy additional credits converted x10; old wallet retained for audit', `v2:legacy:${scope}`);
      await this.ledger(tx, scope, 'AI', plan.monthly_ai_credits, 'Subscription period AI allocation', `v2:period:ai:${scope}:${subscription?.id ?? 'free'}:${start.toISOString()}`);
      await this.ledger(tx, scope, 'CLASSIC', plan.monthly_classic_credits, 'Subscription period Classic allocation', `v2:period:classic:${scope}:${subscription?.id ?? 'free'}:${start.toISOString()}`);
    } else if (wallet.plan_code !== plan.code || wallet.subscription_id !== (subscription?.id ?? null) || wallet.period_start.getTime() !== start.getTime()) {
      await this.ledger(tx, scope, 'AI', plan.monthly_ai_credits - wallet.ai_monthly, 'Expired period replaced; top-up balance preserved', `v2:period:ai:${scope}:${subscription?.id ?? 'free'}:${start.toISOString()}`);
      await this.ledger(tx, scope, 'CLASSIC', plan.monthly_classic_credits - wallet.classic_monthly, 'Expired period replaced; top-up balance preserved', `v2:period:classic:${scope}:${subscription?.id ?? 'free'}:${start.toISOString()}`);
      [wallet] = await tx.$queryRaw<Wallet[]>`UPDATE subscription_v2_wallets SET plan_code=${plan.code},subscription_id=${subscription?.id ?? null},period_start=${start},period_end=${end},ai_monthly=${plan.monthly_ai_credits},classic_monthly=${plan.monthly_classic_credits},updated_at=${now} WHERE owner_scope=${scope} RETURNING *`;
    }
    return wallet;
  }
  async snapshotIn(tx: Tx, owner: SubscriptionOwner) {
    const wallet = await this.ensureIn(tx, owner), plan = subscriptionPlan(wallet.plan_code), day = jakartaDay(this.clock());
    const [stats] = await tx.$queryRaw<{ classic_used: number; classic_reserved: number; reserved_bytes: bigint }[]>`SELECT count(*) FILTER(WHERE lane='classic' AND day_wib=${day}::date AND status='CONSUMED')::int AS classic_used,count(*) FILTER(WHERE lane='classic' AND day_wib=${day}::date AND status='RESERVED')::int AS classic_reserved,COALESCE(sum(storage_reserved) FILTER(WHERE status='RESERVED'),0)::bigint AS reserved_bytes FROM subscription_v2_jobs WHERE owner_scope=${wallet.owner_scope}`;
    const [stored] = await tx.$queryRaw<{ bytes: bigint }[]>`SELECT COALESCE(sum(r.size_bytes),0)::bigint AS bytes FROM results r JOIN generation_jobs j ON j.id=r.job_id WHERE r.deleted_at IS NULL AND ((j.account_id=${owner.account_id} AND ${owner.account_id}::text IS NOT NULL) OR (j.guest_id=${owner.guest_id} AND ${owner.guest_id}::text IS NOT NULL)) AND j.kiosk_session_id IS NULL`;
    return { policy_version: 2, plan: { ...plan }, period_start: wallet.period_start, period_end: wallet.period_end,
      ai: { monthly_remaining: wallet.ai_monthly, top_up_remaining: wallet.ai_top_up, remaining: wallet.ai_monthly + wallet.ai_top_up },
      classic: { monthly_remaining: wallet.classic_monthly, top_up_remaining: wallet.classic_top_up, remaining: wallet.classic_monthly + wallet.classic_top_up, daily_limit: plan.classic_daily_results, daily_used: stats?.classic_used ?? 0, daily_reserved: stats?.classic_reserved ?? 0, daily_remaining: Math.max(0, plan.classic_daily_results - (stats?.classic_used ?? 0) - (stats?.classic_reserved ?? 0)) },
      storage: { used_bytes: Number(stored?.bytes ?? 0), reserved_bytes: Number(stats?.reserved_bytes ?? 0), limit_bytes: plan.storage_bytes },
      legacy_converted_ai_credits: wallet.legacy_converted, catalog: subscriptionCatalog() };
  }
  snapshot(owner: SubscriptionOwner) { return this.db.$transaction(tx => this.snapshotIn(tx, owner)); }

  async claimGuestIn(tx: Tx, accountId: string, guestId: string) {
    const wallet = await this.ensureIn(tx, { account_id: accountId, guest_id: null });
    const guestScope = `guest:${guestId}`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${guestScope},240))::text`;
    const [guest] = await tx.$queryRaw<Wallet[]>`SELECT * FROM subscription_v2_wallets WHERE owner_scope=${guestScope} FOR UPDATE`;
    if (!guest) return;
    const key = `v2:claim:${guestScope}`;
    const [claimed] = await tx.$queryRaw<{ id: bigint }[]>`SELECT id FROM subscription_v2_ledger WHERE idempotency_key=${key}`;
    if (claimed) return;
    // Preserve the Free Classic allowance already spent as a guest; signing up
    // does not reset today's counter or create a second monthly allocation.
    const remaining = wallet.plan_code === 'free' && wallet.period_start.getTime() === guest.period_start.getTime()
      ? Math.min(wallet.classic_monthly, guest.classic_monthly) : wallet.classic_monthly;
    await tx.$executeRaw`UPDATE subscription_v2_wallets SET classic_monthly=${remaining},classic_top_up=classic_top_up+${guest.classic_top_up},ai_top_up=ai_top_up+${guest.ai_top_up} WHERE owner_scope=${wallet.owner_scope}`;
    await tx.$executeRaw`UPDATE subscription_v2_jobs SET owner_scope=${wallet.owner_scope} WHERE owner_scope=${guestScope}`;
    await tx.$executeRaw`UPDATE subscription_v2_results SET owner_scope=${wallet.owner_scope} WHERE owner_scope=${guestScope}`;
    await this.ledger(tx, wallet.owner_scope, 'CLASSIC', remaining - wallet.classic_monthly + guest.classic_top_up, 'Guest Classic usage and top-up transferred on sign in', key);
    await this.ledger(tx, wallet.owner_scope, 'AI', guest.ai_top_up, 'Guest AI top-up transferred on sign in', `${key}:ai`);
    await tx.$executeRaw`UPDATE subscription_v2_wallets SET classic_monthly=0,classic_top_up=0,ai_monthly=0,ai_top_up=0 WHERE owner_scope=${guestScope}`;
  }

  async adjustIn(tx: Tx, accountId: string, currency: 'AI' | 'CLASSIC', amount: number, key: string, reason: string) {
    const wallet = await this.ensureIn(tx, { account_id: accountId, guest_id: null });
    const [previous] = await tx.$queryRaw<{ owner_scope: string; currency: string; amount: number }[]>`SELECT owner_scope,currency,amount FROM subscription_v2_ledger WHERE idempotency_key=${key}`;
    if (previous) {
      if (previous.owner_scope !== wallet.owner_scope || previous.currency !== currency || previous.amount !== amount) throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Kunci sudah digunakan untuk penyesuaian lain.');
      return { changed: false };
    }
    if (!Number.isSafeInteger(amount) || !amount) throw new AppError(422, 'CREDIT_ADJUSTMENT_REJECTED', 'Jumlah penyesuaian tidak valid.');
    const available = currency === 'AI' ? wallet.ai_top_up : wallet.classic_top_up;
    if (available + amount < 0 || available + amount > 2_147_483_647) throw new AppError(422, 'CREDIT_ADJUSTMENT_REJECTED', 'Saldo top-up tidak cukup atau melebihi batas.');
    if (currency === 'AI') await tx.$executeRaw`UPDATE subscription_v2_wallets SET ai_top_up=ai_top_up+${amount} WHERE owner_scope=${wallet.owner_scope}`;
    else await tx.$executeRaw`UPDATE subscription_v2_wallets SET classic_top_up=classic_top_up+${amount} WHERE owner_scope=${wallet.owner_scope}`;
    await this.ledger(tx, wallet.owner_scope, currency, amount, reason, key);
    return { changed: true };
  }

  async history(accountId: string | null, limit = 50, offset = 0) {
    return this.db.$queryRaw<{ id: string; currency: string; amount: number; reason: string; created_at: Date; type: string }[]>`SELECT id::text,currency,amount,reason,created_at,'subscription_v2' AS type FROM subscription_v2_ledger WHERE (${accountId}::text IS NULL OR owner_scope='account:'||${accountId}) ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`;
  }

  async totals(accountId: string | null = null) {
    const scope = accountId ? `account:${accountId}` : null;
    const [spent] = await this.db.$queryRaw<{ ai: bigint; classic: bigint }[]>`SELECT COALESCE(sum(credits) FILTER(WHERE currency='AI'),0)::bigint AS ai,COALESCE(sum(credits) FILTER(WHERE currency='CLASSIC'),0)::bigint AS classic FROM subscription_v2_jobs WHERE status='CONSUMED' AND (${scope}::text IS NULL OR owner_scope=${scope})`;
    const [ledger] = await this.db.$queryRaw<{ granted: bigint; refunded: bigint }[]>`SELECT COALESCE(sum(amount) FILTER(WHERE amount>0 AND idempotency_key NOT LIKE 'v2:refund:%'),0)::bigint AS granted,COALESCE(sum(amount) FILTER(WHERE idempotency_key LIKE 'v2:refund:%'),0)::bigint AS refunded FROM subscription_v2_ledger WHERE currency='AI' AND (${scope}::text IS NULL OR owner_scope=${scope})`;
    return { ai_spent: Number(spent?.ai ?? 0), classic_spent: Number(spent?.classic ?? 0), ai_granted: Number(ledger?.granted ?? 0), ai_refunded: Number(ledger?.refunded ?? 0) };
  }

  async reserveIn(tx: Tx, job: { id: string; mode: string }, owner: SubscriptionOwner, lane: 'standard' | 'fast') {
    const wallet = await this.ensureIn(tx, owner), state = await this.snapshotIn(tx, owner), plan = subscriptionPlan(wallet.plan_code);
    const [existing] = await tx.$queryRaw<Charge[]>`SELECT * FROM subscription_v2_jobs WHERE job_id=${job.id}`;
    if (existing) return existing;
    const price = fixedGenerationPrice(job.mode as 'CLASSIC' | 'BASIC' | 'ADVANCED', lane, plan);
    if (job.mode === 'CLASSIC' && !state.classic.daily_remaining) throw new AppError(429, 'CLASSIC_DAILY_LIMIT', 'Batas Classic hari ini tercapai. Kuota harian reset pukul 00.00 WIB.');
    if (!hasStorageCapacity(plan.storage_bytes, state.storage.used_bytes, state.storage.reserved_bytes, RESULT_CAPACITY_RESERVATION)) throw new AppError(409, 'STORAGE_QUOTA_EXCEEDED', 'Storage penuh atau ruang untuk hasil baru tidak cukup. Hapus hasil lama atau tambah kapasitas.');
    const allocation = creditAllocation(price.currency === 'AI' ? wallet.ai_monthly : wallet.classic_monthly, price.currency === 'AI' ? wallet.ai_top_up : wallet.classic_top_up, price.credits);
    if (price.currency === 'AI') await tx.$executeRaw`UPDATE subscription_v2_wallets SET ai_monthly=ai_monthly-${allocation.subscription},ai_top_up=ai_top_up-${allocation.top_up},updated_at=${this.clock()} WHERE owner_scope=${wallet.owner_scope}`;
    else await tx.$executeRaw`UPDATE subscription_v2_wallets SET classic_monthly=classic_monthly-${allocation.subscription},classic_top_up=classic_top_up-${allocation.top_up},updated_at=${this.clock()} WHERE owner_scope=${wallet.owner_scope}`;
    await tx.$executeRaw`INSERT INTO subscription_v2_jobs(job_id,owner_scope,lane,currency,credits,monthly_part,top_up_part,period_start,day_wib,retention_days)
      VALUES(${job.id},${wallet.owner_scope},${job.mode === 'CLASSIC' ? 'classic' : lane},${price.currency},${price.credits},${allocation.subscription},${allocation.top_up},${wallet.period_start},${jakartaDay(this.clock())}::date,${plan.retention_days})`;
    await this.ledger(tx, wallet.owner_scope, price.currency, -price.credits, 'Generation credit hold; refunded on failure', `v2:hold:${job.id}`);
  }

  async settleIn(tx: Tx, jobId: string, successful: boolean): Promise<boolean | null> {
    const [found] = await tx.$queryRaw<Charge[]>`SELECT * FROM subscription_v2_jobs WHERE job_id=${jobId}`;
    if (!found) return null;
    const [identity] = await tx.$queryRaw<Wallet[]>`SELECT * FROM subscription_v2_wallets WHERE owner_scope=${found.owner_scope}`;
    const wallet = await this.ensureIn(tx, identity);
    const [charge] = await tx.$queryRaw<Charge[]>`SELECT * FROM subscription_v2_jobs WHERE job_id=${jobId} FOR UPDATE`;
    if (charge.status !== 'RESERVED') return false;
    if (!successful) {
      const monthly = wallet.period_start.getTime() === charge.period_start.getTime() ? charge.monthly_part : 0;
      if (charge.currency === 'AI') await tx.$executeRaw`UPDATE subscription_v2_wallets SET ai_monthly=ai_monthly+${monthly},ai_top_up=ai_top_up+${charge.top_up_part} WHERE owner_scope=${wallet.owner_scope}`;
      else await tx.$executeRaw`UPDATE subscription_v2_wallets SET classic_monthly=classic_monthly+${monthly},classic_top_up=classic_top_up+${charge.top_up_part} WHERE owner_scope=${wallet.owner_scope}`;
      await this.ledger(tx, wallet.owner_scope, charge.currency, monthly + charge.top_up_part, 'Failed generation hold returned to original unexpired allocation', `v2:refund:${jobId}`);
    } else {
      const result = await tx.nxResult.findFirst({ where: { job_id: jobId, deleted_at: null } });
      if (!result || result.size_bytes > RESULT_CAPACITY_RESERVATION) throw new AppError(409, 'RESULT_CAPACITY_INVALID', 'Hasil belum tersedia atau melebihi kapasitas reservasi.');
      const expires = subscriptionResultExpiry(result.created_at, { ...subscriptionPlan(wallet.plan_code), retention_days: charge.retention_days });
      await tx.$executeRaw`INSERT INTO subscription_v2_results(result_id,owner_scope,expires_at,retention_days) VALUES(${result.id},${wallet.owner_scope},${expires},${charge.retention_days}) ON CONFLICT(result_id) DO NOTHING`;
    }
    await tx.$executeRaw`UPDATE subscription_v2_jobs SET status=${successful ? 'CONSUMED' : 'REFUNDED'},storage_reserved=0,settled_at=${this.clock()} WHERE job_id=${jobId}`;
    await tx.$executeRaw`UPDATE generation_credit_charges SET status=${successful ? 'PAID' : 'REFUNDED'},credits=${charge.credits},calculation_json=${JSON.stringify({ policy_version: 2, currency: charge.currency, lane: charge.lane, fixed_credits: charge.credits })},settled_at=${this.clock()} WHERE job_id=${jobId}`;
    await tx.nxQuotaReservation.updateMany({ where: { job_id: jobId, status: 'RESERVED' }, data: { status: successful ? 'CONSUMED' : 'REFUNDED', settled_at: this.clock() } });
    return true;
  }
}

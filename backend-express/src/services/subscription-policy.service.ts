import { AppError } from '../lib/errors.js';

// Versioned rules for the approved subscription redesign. These definitions do
// not activate plans, grant balances, change legacy pricing, or call providers.
export const SUBSCRIPTION_POLICY_VERSION = 2;
export const AI_TOP_UP_RUPIAH_PER_CREDIT = 10;
export const CLASSIC_CREDITS_PER_RESULT = 10;
export const STANDARD_AI_CREDITS_PER_RESULT = 50;
export const FAST_AI_CREDITS_PER_RESULT = 100;
export const FAST_AI_QUALITY = 'low';
export type PlanCode = 'free' | 'starter' | 'plus' | 'pro' | 'max';
export type CreditCurrency = 'AI' | 'CLASSIC';
export type SubscriptionPlan = Readonly<{
  code: PlanCode; name: string; price_rupiah: number;
  monthly_ai_credits: number; monthly_classic_credits: number;
  classic_daily_results: number; storage_bytes: number; retention_days: number;
  premium: boolean;
}>;

// Decimal MB/GB, matching the storage measurements and customer-facing quotas.
export const SUBSCRIPTION_PLANS: readonly SubscriptionPlan[] = Object.freeze([
  { code: 'free', name: 'Free', price_rupiah: 0, monthly_ai_credits: 0, monthly_classic_credits: 500, classic_daily_results: 2, storage_bytes: 150_000_000, retention_days: 7, premium: false },
  { code: 'starter', name: 'Starter', price_rupiah: 25_000, monthly_ai_credits: 2_500, monthly_classic_credits: 1_250, classic_daily_results: 5, storage_bytes: 500_000_000, retention_days: 14, premium: true },
  { code: 'plus', name: 'Plus', price_rupiah: 45_000, monthly_ai_credits: 5_000, monthly_classic_credits: 2_750, classic_daily_results: 10, storage_bytes: 1_000_000_000, retention_days: 30, premium: true },
  { code: 'pro', name: 'Pro', price_rupiah: 69_000, monthly_ai_credits: 8_000, monthly_classic_credits: 4_250, classic_daily_results: 15, storage_bytes: 2_000_000_000, retention_days: 60, premium: true },
  { code: 'max', name: 'Max', price_rupiah: 99_000, monthly_ai_credits: 12_000, monthly_classic_credits: 6_250, classic_daily_results: 20, storage_bytes: 4_000_000_000, retention_days: 90, premium: true },
].map(plan => Object.freeze(plan as SubscriptionPlan)));

export function subscriptionPlan(code: string): SubscriptionPlan {
  const plan = SUBSCRIPTION_PLANS.find(item => item.code === code);
  if (!plan) throw new AppError(422, 'SUBSCRIPTION_PLAN_UNKNOWN', 'Paket subscription tidak tersedia.');
  return plan;
}

function nonNegativeInteger(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new AppError(422, 'SUBSCRIPTION_AMOUNT_INVALID', 'Jumlah harus berupa bilangan bulat nonnegatif.');
  return value;
}

export function aiTopUpRupiah(credits: number) {
  nonNegativeInteger(credits);
  const rupiah = credits * AI_TOP_UP_RUPIAH_PER_CREDIT;
  if (!credits || !Number.isSafeInteger(rupiah)) throw new AppError(422, 'SUBSCRIPTION_AMOUNT_INVALID', 'Jumlah AI Credit tidak valid.');
  return rupiah;
}

export function fixedGenerationPrice(mode: 'CLASSIC' | 'BASIC' | 'ADVANCED', lane: 'standard' | 'fast', plan: SubscriptionPlan) {
  if (mode === 'CLASSIC') {
    if (lane !== 'standard') throw new AppError(422, 'GENERATION_LANE_INVALID', 'Classic tidak menggunakan jalur AI.');
    return { currency: 'CLASSIC' as const, credits: CLASSIC_CREDITS_PER_RESULT };
  }
  if (lane === 'standard') return { currency: 'AI' as const, credits: STANDARD_AI_CREDITS_PER_RESULT };
  if (!plan.premium) throw new AppError(403, 'SUBSCRIPTION_REQUIRED', 'Subscription aktif diperlukan untuk Fast.');
  return { currency: 'AI' as const, credits: FAST_AI_CREDITS_PER_RESULT, quality: FAST_AI_QUALITY };
}

export function creditAllocation(subscriptionRemaining: number, topUpRemaining: number, amount: number) {
  nonNegativeInteger(subscriptionRemaining); nonNegativeInteger(topUpRemaining); nonNegativeInteger(amount);
  if (!amount || !Number.isSafeInteger(subscriptionRemaining + topUpRemaining)) throw new AppError(422, 'SUBSCRIPTION_AMOUNT_INVALID', 'Jumlah kredit tidak valid.');
  if (amount > subscriptionRemaining + topUpRemaining) throw new AppError(403, 'CREDIT_BALANCE_EXHAUSTED', 'Saldo kredit tidak mencukupi.');
  const subscription = Math.min(subscriptionRemaining, amount);
  return { subscription, top_up: amount - subscription };
}

export function classicResultsAvailable(plan: SubscriptionPlan, subscriptionCredits: number, topUpCredits: number, successfulToday: number, reservedToday: number) {
  for (const value of [subscriptionCredits, topUpCredits, successfulToday, reservedToday]) nonNegativeInteger(value);
  const sum = subscriptionCredits + topUpCredits;
  if (!Number.isSafeInteger(sum)) throw new AppError(422, 'SUBSCRIPTION_AMOUNT_INVALID', 'Jumlah kredit tidak valid.');
  return Math.min(Math.floor(sum / CLASSIC_CREDITS_PER_RESULT), Math.max(0, plan.classic_daily_results - successfulToday - reservedToday));
}

export function jakartaDay(at: Date) {
  if (!Number.isFinite(at.getTime())) throw new AppError(422, 'SUBSCRIPTION_DATE_INVALID', 'Tanggal tidak valid.');
  return new Date(at.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

export function freeCalendarPeriod(at: Date) {
  const day = jakartaDay(at), year = Number(day.slice(0, 4)), month = Number(day.slice(5, 7));
  return {
    start: new Date(Date.UTC(year, month - 1, 1) - 7 * 3_600_000),
    end: new Date(Date.UTC(year, month, 1) - 7 * 3_600_000),
  };
}

export function hasStorageCapacity(limit: number, stored: number, reserved: number, nextResult: number) {
  for (const value of [limit, stored, reserved, nextResult]) nonNegativeInteger(value);
  const total = stored + reserved + nextResult;
  return Number.isSafeInteger(total) && total <= limit;
}

// Snapshot at creation: changing tiers later does not shorten an existing photo's
// promised lifetime. Extending it via an add-on needs an explicit separate write.
export function subscriptionResultExpiry(createdAt: Date, plan: SubscriptionPlan) {
  if (!Number.isFinite(createdAt.getTime())) throw new AppError(422, 'SUBSCRIPTION_DATE_INVALID', 'Tanggal tidak valid.');
  return new Date(createdAt.getTime() + plan.retention_days * 86_400_000);
}

export function subscriptionCatalog() {
  return {
    policy_version: SUBSCRIPTION_POLICY_VERSION,
    prices: { classic: { currency: 'CLASSIC', credits: CLASSIC_CREDITS_PER_RESULT }, standard: { currency: 'AI', credits: STANDARD_AI_CREDITS_PER_RESULT }, fast: { currency: 'AI', credits: FAST_AI_CREDITS_PER_RESULT, quality: FAST_AI_QUALITY } },
    ai_top_up_rupiah_per_credit: AI_TOP_UP_RUPIAH_PER_CREDIT,
    daily_reset_timezone: 'Asia/Jakarta',
    plans: SUBSCRIPTION_PLANS.map(plan => ({ ...plan,
      classic_results_per_period: plan.monthly_classic_credits / CLASSIC_CREDITS_PER_RESULT,
      fast_results_per_period: plan.monthly_ai_credits / FAST_AI_CREDITS_PER_RESULT,
    })),
  };
}

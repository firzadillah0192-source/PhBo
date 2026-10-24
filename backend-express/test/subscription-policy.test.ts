import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../src/lib/errors.js';
import { subscriptionPlan, subscriptionCatalog, aiTopUpRupiah, fixedGenerationPrice, creditAllocation, classicResultsAvailable, jakartaDay, freeCalendarPeriod, hasStorageCapacity, subscriptionResultExpiry } from '../src/services/subscription-policy.service.js';

test('approved plan matrix preserves the requested quotas including Max mismatch', () => {
  const catalog = subscriptionCatalog();
  assert.deepEqual(catalog.plans.map(p => [p.code, p.price_rupiah, p.monthly_ai_credits, p.monthly_classic_credits, p.classic_daily_results, p.storage_bytes, p.retention_days]), [
    ['free', 0, 0, 500, 2, 150_000_000, 7],
    ['starter', 25_000, 2_500, 1_250, 5, 500_000_000, 14],
    ['plus', 45_000, 5_000, 2_750, 10, 1_000_000_000, 30],
    ['pro', 69_000, 8_000, 4_250, 15, 2_000_000_000, 60],
    ['max', 99_000, 12_000, 6_250, 20, 4_000_000_000, 90],
  ]);
  assert.equal(catalog.plans.at(-1)!.classic_results_per_period, 625);
  assert.equal(catalog.plans.at(-1)!.fast_results_per_period, 120);
  assert.throws(() => subscriptionPlan('invented'), AppError);
  assert.throws(() => { (subscriptionPlan('max') as any).price_rupiah = 1; }, TypeError);
  catalog.plans[0]!.monthly_classic_credits = 999;
  assert.equal(subscriptionPlan('free').monthly_classic_credits, 500);
});

test('AI and Classic consume separate currencies; Fast Low requires subscription', () => {
  assert.deepEqual(fixedGenerationPrice('CLASSIC', 'standard', subscriptionPlan('free')), { currency: 'CLASSIC', credits: 10 });
  for (const mode of ['BASIC', 'ADVANCED'] as const) {
    assert.throws(() => fixedGenerationPrice(mode, 'fast', subscriptionPlan('free')), /Subscription/);
    assert.deepEqual(fixedGenerationPrice(mode, 'fast', subscriptionPlan('starter')), { currency: 'AI', credits: 100, quality: 'low' });
    assert.deepEqual(fixedGenerationPrice(mode, 'standard', subscriptionPlan('free')), { currency: 'AI', credits: 50 });
  }
  assert.throws(() => fixedGenerationPrice('CLASSIC', 'fast', subscriptionPlan('max')), /Classic/);
});

test('AI top-up has explicit currency value and rejects malformed or overflowing amounts', () => {
  assert.equal(aiTopUpRupiah(1_000), 10_000);
  for (const credits of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) assert.throws(() => aiTopUpRupiah(credits), AppError);
});

test('subscription is spent before nonexpiring top-up without permitting overdrafts', () => {
  assert.deepEqual(creditAllocation(80, 100, 100), { subscription: 80, top_up: 20 });
  assert.deepEqual(creditAllocation(0, 100, 100), { subscription: 0, top_up: 100 });
  assert.deepEqual(creditAllocation(100, 0, 100), { subscription: 100, top_up: 0 });
  assert.throws(() => creditAllocation(50, 49, 100), /Saldo/);
  assert.throws(() => creditAllocation(50, 100, -1), AppError);
});

test('Classic top-up cannot bypass daily limits; reservations occupy a daily slot', () => {
  const free = subscriptionPlan('free');
  assert.equal(classicResultsAvailable(free, 500, 0, 0, 0), 2);
  assert.equal(classicResultsAvailable(free, 500, 1_000, 1, 1), 0);
  assert.equal(classicResultsAvailable(free, 0, 9, 0, 0), 0);
  assert.equal(classicResultsAvailable(free, 0, 10, 0, 0), 1);
  assert.equal(classicResultsAvailable(subscriptionPlan('max'), 6_250, 0, 0, 0), 20);
});

test('daily and Free monthly resets follow WIB including year boundaries', () => {
  assert.equal(jakartaDay(new Date('2026-10-18T16:59:59Z')), '2026-10-18');
  assert.equal(jakartaDay(new Date('2026-10-18T17:00:00Z')), '2026-10-19');
  const period = freeCalendarPeriod(new Date('2026-12-31T17:00:00Z'));
  assert.equal(period.start.toISOString(), '2026-12-31T17:00:00.000Z');
  assert.equal(period.end.toISOString(), '2027-01-31T17:00:00.000Z');
  assert.throws(() => jakartaDay(new Date(NaN)), AppError);
});

test('storage uses exact byte boundaries and accounts for reserved capacity', () => {
  const limit = subscriptionPlan('starter').storage_bytes;
  assert.equal(hasStorageCapacity(limit, limit - 100, 50, 50), true);
  assert.equal(hasStorageCapacity(limit, limit - 100, 50, 51), false);
  assert.equal(hasStorageCapacity(limit, limit + 1, 0, 0), false);
  assert.throws(() => hasStorageCapacity(limit, -1, 0, 0), AppError);
});

test('photo expiry uses the selected plan at creation with no tier-dependent retroactive shortening', () => {
  const created = new Date('2026-10-18T00:00:00Z');
  assert.equal(subscriptionResultExpiry(created, subscriptionPlan('free')).toISOString(), '2026-10-25T00:00:00.000Z');
  const saved = subscriptionResultExpiry(created, subscriptionPlan('max'));
  assert.equal(saved.toISOString(), '2027-01-16T00:00:00.000Z');
  subscriptionPlan('free');
  assert.equal(saved.toISOString(), '2027-01-16T00:00:00.000Z');
});

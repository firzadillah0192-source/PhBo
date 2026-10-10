import type { Prisma, NxProviderRun } from '@prisma/client';
import { calculateTokenCharge, type TokenUsage } from './credit-pricing.service.js';
import { estimateImagePrice } from './image-pricing.service.js';

export function priceProviderRun(run: NxProviderRun) {
  const model = (run.provider_reported_model || run.requested_model || run.provider_model || '').split('/').at(-1)!;
  if (model !== 'gpt-image-2.5' && !model.startsWith('gpt-image-2.5-')) return null;
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(run.provider_usage_raw_json || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>;
  } catch { /* Older rows may still have valid counters in their columns. */ }
  const usage: Record<string, number> = {};
  const keys = ['input_tokens','output_tokens','input_text_tokens','input_image_tokens','output_image_tokens','cached_text_tokens','cached_image_tokens','cached_tokens'] as const;
  for (const key of keys) {
    const value = raw[key] ?? (key.startsWith('cached_') ? undefined : run[key as keyof NxProviderRun]);
    if (value == null) continue;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null;
    usage[key] = value;
  }
  if ((usage.cached_text_tokens ?? 0) > (usage.input_text_tokens ?? Infinity)
    || (usage.cached_image_tokens ?? 0) > (usage.input_image_tokens ?? Infinity)) return null;
  if (usage.cached_tokens !== undefined && usage.input_tokens !== undefined && usage.cached_tokens > usage.input_tokens) return null;
  if (usage.cached_tokens !== undefined && usage.cached_text_tokens !== undefined && usage.cached_image_tokens !== undefined && usage.cached_tokens !== usage.cached_text_tokens + usage.cached_image_tokens) return null;
  const precise = calculateTokenCharge(usage as Partial<TokenUsage>);
  if (precise) return { token_usd: precise.token_usd, estimated: false, basis: 'reported_token_breakdown', usage };
  // Reuse the admin estimate. Aggregate totals use its upper simulation:
  // all input/output at image rates, with reported cache discounted once.
  const estimate = estimateImagePrice({ ...run, ...usage, provider_usage_raw_json: JSON.stringify(usage) });
  if (estimate.high_usd == null || !Number.isFinite(estimate.high_usd) || estimate.high_usd < 0) return null;
  return { token_usd: estimate.high_usd, estimated: true,
    basis: estimate.status === 'simulation' ? 'estimated_aggregate_tokens_upper' : 'estimated_uncached_token_breakdown', usage };
}
export type GenerationCharge = { status: string; credits: number | null; calculation_json: string | null };
export async function readGenerationCharge(tx: Prisma.TransactionClient, id: string) {
  const [row] = await tx.$queryRaw<GenerationCharge[]>`SELECT status,credits,calculation_json FROM generation_credit_charges WHERE job_id=${id}`;
  return row ?? null;
}
export async function priceCompletedGeneration(tx: Prisma.TransactionClient, id: string, mode: string) {
  if (mode === 'CLASSIC') return { credits: 1, calculation: { mode: 'CLASSIC', credits: 1, basis: 'photo_booth_flat_rate' } };
  const runs = await tx.nxProviderRun.findMany({ where: { generation_job_id: id, upstream_status: 'SUCCEEDED' } });
  if (!runs.length) return null;
  let tokenUsd = 0;
  const pricedRuns = [];
  for (const run of runs) {
    const model = (run.provider_reported_model || run.requested_model || run.provider_model || '').split('/').at(-1)!;
    if (model !== 'gpt-image-2.5' && !model.startsWith('gpt-image-2.5-')) return null;
    const cost = priceProviderRun(run);
    if (!cost) return null;
    tokenUsd += cost.token_usd;
    pricedRuns.push({ run_id: run.id, ...cost });
  }
  const saleRupiah = tokenUsd * 18000 * 1.2;
  const credits = Math.ceil(Math.round(saleRupiah * 1000000) / 100000000);
  if (!Number.isSafeInteger(credits) || credits > 2147483647) return null;
  const estimated = pricedRuns.some(run => run.estimated);
  return { credits, calculation: { token_usd: tokenUsd, token_rupiah: tokenUsd * 18000, service_rupiah: tokenUsd * 18000 * .2, sale_rupiah: saleRupiah, usd_to_idr: 18000, service_fee_percent: 20, rupiah_per_credit: 100, credits, estimated, basis: estimated ? 'admin_estimate_upper' : 'reported_token_breakdown', provider_runs: pricedRuns, assumptions: estimated ? 'Upper admin estimate; reported cache subtracted once, unreported cache receives no discount. Failed attempts excluded.' : null } };
}

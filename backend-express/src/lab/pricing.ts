import type { Pricing } from './types.js';

export type PriceQuery = { reference_images: number; width?: number; height?: number; count?: number; quality?: string };
export type PriceEstimate = { known: boolean; usd: number | null; breakdown: { label: string; usd: number }[]; assumptions: string; reason?: string };
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const round = (value: number) => Math.round(value * 1e6) / 1e6;
export const emptyPricing = (): Pricing => ({ method: 'unknown', currency: 'USD', source: '', verified_at: null, assumptions: '' });

// Never invents a price: any missing input yields known=false ("Pricing Unknown").
export function estimate(pricing: Pricing, query: PriceQuery): PriceEstimate {
  const count = query.count ?? 1, breakdown: { label: string; usd: number }[] = [];
  const unknown = (reason: string): PriceEstimate => ({ known: false, usd: null, breakdown: [], assumptions: pricing.assumptions, reason });
  switch (pricing.method) {
    case 'per_image':
      if (!finite(pricing.per_image_usd)) return unknown('Price per image is not configured.');
      breakdown.push({ label: `Generation x${count}`, usd: pricing.per_image_usd * count }); break;
    case 'per_megapixel': {
      if (!finite(pricing.per_megapixel_usd)) return unknown('Price per megapixel is not configured.');
      if (!query.width || !query.height) return unknown('Output size is required to price per megapixel.');
      breakdown.push({ label: `${((query.width * query.height) / 1e6).toFixed(2)} MP x${count}`, usd: pricing.per_megapixel_usd * (query.width * query.height) / 1e6 * count }); break;
    }
    case 'tokens': {
      if (!finite(pricing.input_usd_per_million_tokens) || !finite(pricing.output_usd_per_million_tokens)) return unknown('Token prices are not configured.');
      const tiers = pricing.assumed_output_tokens_by_quality;
      let outputTokens = pricing.assumed_output_tokens;
      if (tiers && Object.keys(tiers).length) {
        if (!query.quality) return unknown(`Choose a quality (${Object.keys(tiers).join(', ')}) to price this request.`);
        outputTokens = tiers[query.quality];
        if (!finite(outputTokens)) return unknown(`No token assumption for quality "${query.quality}". Enter one on the model, or run and read the measured cost.`);
      }
      if (!finite(pricing.assumed_input_tokens) || !finite(outputTokens)) return unknown('Assumed token counts are required to estimate before running.');
      breakdown.push({ label: 'Input tokens', usd: pricing.assumed_input_tokens / 1e6 * pricing.input_usd_per_million_tokens * count },
        { label: `Output tokens${query.quality ? ` (${query.quality})` : ''}`, usd: outputTokens / 1e6 * pricing.output_usd_per_million_tokens * count }); break;
    }
    case 'compute_time':
      if (!finite(pricing.per_second_usd) || !finite(pricing.assumed_seconds)) return unknown('Per-second price and assumed duration are required.');
      breakdown.push({ label: `${pricing.assumed_seconds}s compute x${count}`, usd: pricing.per_second_usd * pricing.assumed_seconds * count }); break;
    default: return unknown('Pricing Unknown: no verified price schedule is configured.');
  }
  if (finite(pricing.reference_image_fee_usd) && pricing.reference_image_fee_usd > 0 && query.reference_images > 0)
    breakdown.push({ label: `Reference images x${query.reference_images * count}`, usd: pricing.reference_image_fee_usd * query.reference_images * count });
  return { known: true, usd: round(breakdown.reduce((sum, item) => sum + item.usd, 0)), breakdown: breakdown.map(item => ({ ...item, usd: round(item.usd) })), assumptions: pricing.assumptions };
}

// Cost derived from measured usage and a configured schedule; null when usage is not available.
export function calculateFromUsage(pricing: Pricing, usage: Record<string, number> | null | undefined, inferenceMs: number | null | undefined, references: number): number | null {
  if (pricing.method === 'tokens' && usage && finite(pricing.input_usd_per_million_tokens) && finite(pricing.output_usd_per_million_tokens)
    && finite(usage.input_tokens) && finite(usage.output_tokens))
    return round(usage.input_tokens / 1e6 * pricing.input_usd_per_million_tokens + usage.output_tokens / 1e6 * pricing.output_usd_per_million_tokens + (pricing.reference_image_fee_usd ?? 0) * references);
  if (pricing.method === 'compute_time' && finite(inferenceMs) && finite(pricing.per_second_usd))
    return round(inferenceMs / 1000 * pricing.per_second_usd + (pricing.reference_image_fee_usd ?? 0) * references);
  return null;
}
export function validatePricing(input: unknown): Pricing {
  const p = input as Pricing;
  if (!p || typeof p !== 'object' || !['unknown', 'per_image', 'per_megapixel', 'tokens', 'compute_time', 'provider_quote'].includes(p.method)) throw new Error('Invalid pricing method');
  const out: Pricing = { method: p.method, currency: 'USD', source: String(p.source ?? '').slice(0, 300), verified_at: p.verified_at ? new Date(p.verified_at).toISOString() : null, assumptions: String(p.assumptions ?? '').slice(0, 1000) };
  for (const key of ['per_image_usd', 'per_megapixel_usd', 'input_usd_per_million_tokens', 'output_usd_per_million_tokens', 'per_second_usd', 'reference_image_fee_usd', 'assumed_input_tokens', 'assumed_output_tokens', 'assumed_seconds'] as const) {
    const value = p[key];
    if (value === undefined || value === null || (value as unknown) === '') continue;
    if (!finite(value) || value > 1e9) throw new Error(`Invalid ${key}`);
    out[key] = value;
  }
  const tiers = p.assumed_output_tokens_by_quality;
  if (tiers && typeof tiers === 'object') {
    const clean: Record<string, number> = {};
    for (const [key, value] of Object.entries(tiers).slice(0, 12)) if (/^[a-z0-9_-]{1,24}$/i.test(key) && finite(value) && value <= 1e7) clean[key] = value;
    if (Object.keys(clean).length) out.assumed_output_tokens_by_quality = clean;
  }
  return out;
}

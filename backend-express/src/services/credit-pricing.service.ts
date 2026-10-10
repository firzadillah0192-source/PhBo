export const USD_TO_IDR = 18000;
export const SERVICE_FEE = 0.20;
export const RUPIAH_PER_CREDIT = 100;
export type TokenUsage = {
  input_text_tokens: number; input_image_tokens: number; output_image_tokens: number;
  cached_text_tokens: number; cached_image_tokens: number;
};
const token = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export function calculateTokenCharge(usage: Partial<TokenUsage>) {
  const keys = ['input_text_tokens', 'input_image_tokens', 'output_image_tokens', 'cached_text_tokens', 'cached_image_tokens'] as const;
  if (!keys.every(key => token(usage[key]))) return null;
  const u = usage as TokenUsage;
  if (u.cached_text_tokens > u.input_text_tokens || u.cached_image_tokens > u.input_image_tokens) return null;
  // Input totals INCLUDE cached tokens. Subtract cache before the uncached rate.
  const weighted = (u.input_text_tokens - u.cached_text_tokens) * 5 + u.cached_text_tokens * 1.25
    + (u.input_image_tokens - u.cached_image_tokens) * 8 + u.cached_image_tokens * 2 + u.output_image_tokens * 30;
  const usd = weighted / 1000000;
  const tokenRupiah = usd * USD_TO_IDR;
  const serviceRupiah = tokenRupiah * SERVICE_FEE;
  const saleRupiah = tokenRupiah + serviceRupiah;
  // Protect ceil against floating point noise at an exact credit boundary.
  const credits = Math.ceil(Math.round(saleRupiah * 1000000) / 100000000);
  if (!Number.isFinite(usd) || !Number.isSafeInteger(credits) || credits > 2147483647) return null;
  return { token_usd: usd, token_rupiah: tokenRupiah, service_rupiah: serviceRupiah, sale_rupiah: saleRupiah, credits,
    usd_to_idr: USD_TO_IDR, service_fee_percent: 20, rupiah_per_credit: RUPIAH_PER_CREDIT };
}
export function normalizedImageUsage(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const result: Record<string, number> = {};
  const aliases: Record<string, unknown> = { ...raw };
  const details = raw.input_tokens_details && typeof raw.input_tokens_details === 'object' ? raw.input_tokens_details as Record<string, unknown> : null;
  if (details) {
    aliases.input_text_tokens ??= details.text_tokens;
    aliases.input_image_tokens ??= details.image_tokens;
    const cached = details.cached_tokens_details && typeof details.cached_tokens_details === 'object' ? details.cached_tokens_details as Record<string, unknown> : null;
    if (cached) { aliases.cached_text_tokens ??= cached.text_tokens; aliases.cached_image_tokens ??= cached.image_tokens; }
    // No cache applies to direct image endpoint requests unless explicitly reported.
    if (details.cached_tokens === 0) { aliases.cached_text_tokens ??= 0; aliases.cached_image_tokens ??= 0; }
  }
  if (!details && !Object.values(raw).some(token)) return null;
  const reportedCachedTotal = details?.cached_tokens ?? raw.cached_tokens ?? raw.cached_input_tokens;
  aliases.cached_tokens ??= details?.cached_tokens ?? raw.cached_input_tokens;
  if (reportedCachedTotal === 0) { aliases.cached_text_tokens ??= 0; aliases.cached_image_tokens ??= 0; }
  // Direct image endpoint output_tokens represents image output, not text output.
  aliases.output_image_tokens ??= raw.output_tokens;
  for (const key of ['input_tokens','output_tokens','total_tokens','input_text_tokens','input_image_tokens','output_image_tokens','cached_text_tokens','cached_image_tokens','cached_tokens','billable_units']) if (token(aliases[key])) result[key] = aliases[key] as number;
  return Object.keys(result).length ? result : null;
}

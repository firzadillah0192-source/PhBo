import { createHash } from 'node:crypto';
import { redact } from '../crypto.js';
import { LabError, type AdapterContext, type AdapterRequest, type AdapterResult, type BillingLookup, type BillingRecord, type LabAdapter, type QuoteResult, type ResultState } from '../types.js';
import { asImage, authHeaders, download, failIfBad, join, parseJson, providerMessage, send } from './common.js';

// WaveSpeedAI v3 API.
//  - Connection test:  GET  /api/v3/balance                       (docs/check-balance)
//  - Price quotation:  POST /api/v3/model/price {model_id,inputs}  (docs/pricing-api) - non-billable, no fallback to a base price
//  - Generation:       POST /api/v3/{model_id}, exactly once; result GET /api/v3/predictions/{id}/result (docs/predictions-api)
//  - Billing:          POST /api/v3/billings/search {prediction_uuids} (docs/check-billings) - Owner/Admin/Billing keys only
// Input images are uploaded through the media-upload ticket flow of the official SDK and cached briefly so that the
// price quotation and the generation use the same uploaded files.
const FAILED = new Set(['failed', 'cancelled', 'timeout', 'deleted']);
const api = (ctx: AdapterContext, path: string) => join(ctx.baseUrl.replace(/\/+$/, '').replace(/\/api\/v3$/, ''), `/api/v3${path}`);
const jsonHeaders = (ctx: AdapterContext) => ({ ...authHeaders(ctx), 'Content-Type': 'application/json' });
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

const uploads = new Map<string, { url: string; at: number }>();
const UPLOAD_TTL_MS = 20 * 60 * 1000;
async function uploadCached(ctx: AdapterContext, bytes: Buffer, contentType: string, filename: string) {
  const key = `${ctx.cacheKey ?? ctx.baseUrl}:${createHash('sha256').update(bytes).digest('hex')}`, hit = uploads.get(key);
  if (hit && Date.now() - hit.at < UPLOAD_TTL_MS) return hit.url;
  for (const [k, v] of uploads) if (Date.now() - v.at >= UPLOAD_TTL_MS) uploads.delete(k);
  const url = await upload(ctx, bytes, contentType, filename);
  uploads.set(key, { url, at: Date.now() });
  return url;
}
async function inputs(ctx: AdapterContext, req: AdapterRequest) {
  const body: Record<string, unknown> = { prompt: req.prompt, ...(req.params ?? {}) };
  if (req.images.length) {
    const urls: string[] = [];
    for (const [index, image] of req.images.entries()) urls.push(await uploadCached(ctx, image.bytes, image.contentType, `lab-${index}.${image.contentType === 'image/png' ? 'png' : image.contentType === 'image/webp' ? 'webp' : 'jpg'}`));
    if (req.image_field === 'image') body.image = urls[0]; else body.images = urls; // a few models take one image in `image`
  }
  return body;
}

async function priceCall(ctx: AdapterContext, body: Record<string, unknown>) {
  const response = await send(ctx, { method: 'POST', url: api(ctx, '/model/price'), auth: true, headers: jsonHeaders(ctx), body: JSON.stringify(body), timeoutMs: 30000 });
  const parsed = parseJson(response), data = parsed.data ?? {};
  if (response.status < 200 || response.status >= 300 || (typeof parsed.code === 'number' && parsed.code !== 200)) {
    const code = typeof parsed.code === 'number' ? parsed.code : response.status;
    return { ok: false as const, code, reason: `WaveSpeed could not price this request (code ${code})${providerMessage(ctx, response) ? ` — ${providerMessage(ctx, response)}` : ''}` };
  }
  if (!finite(data.price) || !finite(data.discounted_price) || !finite(data.discount_rate) || (data.currency && data.currency !== 'USD'))
    return { ok: false as const, code: 'INVALID_QUOTE', reason: 'WaveSpeed returned an incomplete or non-USD price quotation.' };
  return { ok: true as const, price: data.price, discounted: data.discounted_price, rate: data.discount_rate };
}

function records(ctx: AdapterContext, body: Record<string, any>, filter: (item: any) => boolean): BillingRecord[] {
  const items: any[] = Array.isArray(body.data?.items) ? body.data.items : [], seen = new Set<string>(), out: BillingRecord[] = [];
  for (const item of items) {
    if (!item || typeof item.uuid !== 'string' || seen.has(item.uuid) || !filter(item) || !finite(item.price)) continue; // duplicates by record uuid are ignored
    seen.add(item.uuid);
    out.push({ uuid: item.uuid, ...(typeof item.prediction?.uuid === 'string' ? { prediction_uuid: item.prediction.uuid } : {}), billing_type: String(item.billing_type ?? 'unknown').slice(0, 40), price: item.price, created_at: String(item.created_at ?? '') });
  }
  return out;
}
async function billingCall(ctx: AdapterContext, payload: Record<string, unknown>, filter: (item: any) => boolean): Promise<BillingLookup> {
  let response;
  try { response = await send(ctx, { method: 'POST', url: api(ctx, '/billings/search'), auth: true, headers: jsonHeaders(ctx), body: JSON.stringify(payload), timeoutMs: 30000 }); }
  catch { return { access: 'error', records: [], message: 'Could not reach WaveSpeed billing.' }; }
  const detail = providerMessage(ctx, response);
  if (response.status === 401 || response.status === 403)
    return { access: 'denied', records: [], message: `Billing access denied (HTTP ${response.status})${detail ? ` — ${detail}` : ''}. Billing search needs a key created by an Owner, Admin or Billing member; Developer keys cannot use it.` };
  const body = parseJson(response);
  if (response.status < 200 || response.status >= 300 || (typeof body.code === 'number' && body.code !== 200)) return { access: 'error', records: [], message: `Billing lookup failed (HTTP ${response.status})${detail ? ` — ${detail}` : ''}` };
  return { access: 'ok', records: records(ctx, body, filter), truncated: body.data?.has_more === true };
}

export const wavespeedAdapter: LabAdapter = {
  type: 'wavespeed', defaultBaseUrl: 'https://api.wavespeed.ai',
  async testConnection(ctx) {
    // Official free, read-only check: GET /api/v3/balance. No generation is run.
    let response;
    try { response = await send(ctx, { method: 'GET', url: api(ctx, '/balance'), auth: true, headers: authHeaders(ctx), timeoutMs: 20000 }); }
    catch (error) { return { ok: false, message: `Could not reach WaveSpeed: ${error instanceof Error ? redact(error.message, [ctx.secret], 160) : 'connection failed'}` }; }
    const detail = providerMessage(ctx, response), suffix = detail ? ` — ${detail}` : '';
    if (response.status >= 200 && response.status < 300) {
      const body = parseJson(response);
      if (typeof body.code === 'number' && body.code !== 200) return { ok: false, message: `WaveSpeed answered code ${body.code}${suffix}` };
      const balance = Number(body.data?.balance);
      return { ok: true, message: `Credentials accepted${Number.isFinite(balance) ? `. Balance: $${balance.toFixed(2)}` : ''}. No generation was run.` };
    }
    if (response.status === 401) return { ok: false, message: `WaveSpeed rejected the API key (HTTP 401)${suffix}` };
    if (response.status === 403) return { ok: false, message: `WaveSpeed denied access (HTTP 403)${suffix}. In team organizations the key must belong to an Owner, Admin, Developer or Billing member.` };
    if (response.status === 429) return { ok: false, message: `WaveSpeed rate limit reached (HTTP 429)${suffix}. Try again shortly.` };
    return { ok: false, message: `WaveSpeed answered HTTP ${response.status}${suffix}` };
  },

  async quote(ctx, req): Promise<QuoteResult> {
    const unavailable = (reason: string, code?: string | number): QuoteResult => ({ available: false, original_usd: null, discounted_usd: null, payable_percent: null, currency: 'USD', reason, ...(code !== undefined ? { code } : {}) });
    let body;
    try { body = await inputs(ctx, req); } catch (error) { return unavailable(error instanceof LabError ? redact(error.message, [ctx.secret]) : 'Input images could not be prepared for pricing.', 'INPUT_UPLOAD'); }
    let quoted;
    try { quoted = await priceCall(ctx, { model_id: req.model_id, inputs: body }); } catch { return unavailable('WaveSpeed pricing could not be reached.', 'UNREACHABLE'); }
    if (!quoted.ok) return unavailable(quoted.reason, quoted.code);
    // Published base price for comparison only; it is never used as the quotation.
    let base: QuoteResult['base'] = null;
    try { const b = await priceCall(ctx, { model_id: req.model_id }); if (b.ok) base = { price: b.price, discounted_price: b.discounted }; } catch { /* informational */ }
    return { available: true, original_usd: quoted.price, discounted_usd: quoted.discounted, payable_percent: quoted.rate, currency: 'USD', base };
  },

  async result(ctx, id): Promise<ResultState> {
    const poll = await send(ctx, { method: 'GET', url: api(ctx, `/predictions/${encodeURIComponent(id)}/result`), auth: true, headers: authHeaders(ctx) });
    failIfBad(ctx, poll, 'WaveSpeed result');
    const data = parseJson(poll).data ?? {}, status = String(data.status ?? '');
    if (status === 'completed') {
      const first = (Array.isArray(data.outputs) ? data.outputs : []).find((item: unknown): item is string => typeof item === 'string');
      if (!first) throw new LabError(502, 'LAB_OUTPUT_UNAVAILABLE', 'WaveSpeed completed without an output image.');
      const image = first.startsWith('http') ? await download(ctx, first) : await asImage(Buffer.from(first, 'base64'));
      return { state: 'completed', status, image, ...(Number.isFinite(data.timings?.inference) ? { inference_ms: Number(data.timings.inference) } : {}) };
    }
    if (FAILED.has(status)) return { state: 'failed', status, error: data.error ? redact(data.error, [ctx.secret], 200) : '' };
    return { state: 'pending', status };
  },

  async generate(ctx: AdapterContext, req: AdapterRequest): Promise<AdapterResult> {
    const deadlineAt = Date.now() + ctx.timeoutMs;
    const body = await inputs(ctx, { ...req });
    // The submit POST is sent exactly once. Any ambiguity about whether the provider accepted it is surfaced, never retried.
    const ambiguous = (why: string) => new LabError(502, 'LAB_SUBMIT_AMBIGUOUS', `${why} The request may have been accepted and billed. It was NOT retried; reconcile billing before testing again.`);
    let submit;
    try { submit = await send(ctx, { method: 'POST', url: api(ctx, `/${req.model_id}`), auth: true, headers: jsonHeaders(ctx), body: JSON.stringify({ ...body, enable_base64_output: false, enable_sync_mode: false }), timeoutMs: 60000 }); }
    catch { throw ambiguous('The submission did not complete (network error or timeout).'); }
    if (submit.status >= 500) throw ambiguous(`WaveSpeed answered HTTP ${submit.status} to the submission.`);
    failIfBad(ctx, submit, 'WaveSpeed submit');
    const id = typeof parseJson(submit).data?.id === 'string' ? (parseJson(submit).data.id as string) : null;
    if (!id) throw ambiguous('WaveSpeed accepted the submission but returned no prediction id.');
    await req.onSubmitted?.(id);
    let transient = 0;
    for (;;) {
      let state: ResultState | null = null;
      try { state = await wavespeedAdapter.result!(ctx, id); transient = 0; }
      catch (error) {
        // Result queries are non-billable and may be retried.
        const retryable = !(error instanceof LabError) || ['LAB_PROVIDER_ERROR', 'LAB_PROVIDER_RATE_LIMITED', 'LAB_PROVIDER_UNREACHABLE', 'LAB_TIMEOUT', 'LAB_OUTPUT_UNAVAILABLE'].includes(error.code);
        if (!retryable || ++transient > 3) throw error;
      }
      if (state?.state === 'completed') return { request_id: id, images: [state.image!], ...(state.inference_ms !== undefined ? { inference_ms: state.inference_ms } : {}) };
      if (state?.state === 'failed') throw new LabError(502, 'LAB_PROVIDER_FAILED', `WaveSpeed prediction ${state.status}${state.error ? `: ${state.error}` : ''}`);
      if (Date.now() > deadlineAt) throw new LabError(504, 'LAB_TIMEOUT', `Timed out waiting for prediction ${id}. It may still complete and be billed; use Re-check result.`);
      await ctx.sleep(ctx.pollIntervalMs);
    }
  },

  billing: (ctx, id) => billingCall(ctx, { prediction_uuids: [id], page: 1, page_size: 10 }, item => item.prediction?.uuid === id),
  billingWindow: (ctx, modelId, fromIso, toIso) => billingCall(ctx, { model_uuid: modelId, start_time: fromIso, end_time: toIso, sort: 'created_at DESC', page: 1, page_size: 100 }, item => item.prediction?.model_uuid === modelId),
};

async function upload(ctx: AdapterContext, bytes: Buffer, contentType: string, filename: string) {
  const ticket = await send(ctx, { method: 'POST', url: api(ctx, '/media/uploads'), auth: true, headers: jsonHeaders(ctx), body: JSON.stringify({ filename, size: bytes.length, content_type: contentType }) });
  failIfBad(ctx, ticket, 'WaveSpeed upload ticket');
  const data = parseJson(ticket).data ?? {}, instruction = data.upload ?? {};
  if (String(instruction.method ?? '').toUpperCase() !== 'PUT' || typeof instruction.url !== 'string' || typeof data.download_url !== 'string')
    throw new LabError(502, 'LAB_PROVIDER_ERROR', 'WaveSpeed returned an unexpected upload instruction.');
  const put = await ctx.http.request({ method: 'PUT', url: instruction.url, headers: instruction.headers && typeof instruction.headers === 'object' ? instruction.headers : { 'Content-Type': contentType }, body: bytes, timeoutMs: 60000 });
  if (put.status < 200 || put.status >= 300) throw new LabError(502, 'LAB_PROVIDER_ERROR', `WaveSpeed upload failed (HTTP ${put.status}).`);
  return data.download_url as string;
}

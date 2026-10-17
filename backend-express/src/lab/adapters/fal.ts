import { LabError, type AdapterContext, type AdapterRequest, type AdapterResult, type LabAdapter } from '../types.js';
import { authHeaders, deadline, download, failIfBad, join, parseJson, send } from './common.js';

// fal.ai queue API: POST queue.fal.run/{model} -> {request_id,status_url,response_url}; poll status_url until
// COMPLETED, then GET response_url. Images are passed as data URIs in image_urls.
export const falAdapter: LabAdapter = {
  type: 'fal', defaultBaseUrl: 'https://queue.fal.run',
  async testConnection() { return { ok: false, inconclusive: true, message: 'fal.ai has no free credential check. Run a small paid test from the Image Playground to verify.' }; },
  async generate(ctx: AdapterContext, req: AdapterRequest): Promise<AdapterResult> {
    const expired = deadline(ctx);
    const payload: Record<string, unknown> = { prompt: req.prompt };
    if (req.images.length) payload.image_urls = req.images.map(item => `data:${item.contentType};base64,${item.bytes.toString('base64')}`);
    if (req.negative_prompt) payload.negative_prompt = req.negative_prompt;
    if (req.seed !== undefined) payload.seed = req.seed;
    if (req.output_format) payload.output_format = req.output_format;
    if (req.size) { const m = req.size.match(/^(\d+)[x*](\d+)$/); if (m) payload.image_size = { width: Number(m[1]), height: Number(m[2]) }; }
    const submit = await send(ctx, { method: 'POST', url: join(ctx.baseUrl, `/${req.model_id}`), auth: true, timeoutMs: 60000, headers: { ...authHeaders(ctx), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    failIfBad(ctx, submit, 'fal submit');
    const queued = parseJson(submit);
    if (typeof queued.request_id !== 'string' || typeof queued.status_url !== 'string' || typeof queued.response_url !== 'string') throw new LabError(502, 'LAB_PROVIDER_ERROR', 'fal did not return a queue handle.');
    for (;;) {
      const status = await send(ctx, { method: 'GET', url: queued.status_url, auth: true, headers: authHeaders(ctx) });
      failIfBad(ctx, status, 'fal status');
      const state = parseJson(status).status;
      if (state === 'COMPLETED') break;
      if (state !== 'IN_QUEUE' && state !== 'IN_PROGRESS') throw new LabError(502, 'LAB_PROVIDER_FAILED', `fal request ended with status ${String(state).slice(0, 40)}.`);
      if (expired()) throw new LabError(504, 'LAB_TIMEOUT', `Timed out waiting for fal request ${queued.request_id}. It may still run and be billed.`);
      await ctx.sleep(ctx.pollIntervalMs);
    }
    const result = await send(ctx, { method: 'GET', url: queued.response_url, auth: true, headers: authHeaders(ctx) });
    failIfBad(ctx, result, 'fal result');
    const body = parseJson(result), url = body.images?.[0]?.url ?? body.image?.url;
    if (typeof url !== 'string') throw new LabError(502, 'LAB_OUTPUT_UNAVAILABLE', 'fal completed without an output image.');
    return { request_id: queued.request_id, images: [await download(ctx, url)] };
  },
};

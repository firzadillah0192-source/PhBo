import { LabError, type AdapterContext, type AdapterRequest, type AdapterResult, type LabAdapter } from '../types.js';
import { authHeaders, deadline, download, failIfBad, join, parseJson, send } from './common.js';

// Runway API: POST /text_to_image (gen4_image, gen4_image_turbo, ...) returns a task id; poll GET /tasks/{id} until
// SUCCEEDED and download output[0]. Reference images go in referenceImages as data URIs. Submitted once, never retried.
const VERSION = '2024-11-06';
const headers = (ctx: AdapterContext, json = false) => ({ ...authHeaders(ctx), 'X-Runway-Version': VERSION, ...(json ? { 'Content-Type': 'application/json' } : {}) });
export const runwayAdapter: LabAdapter = {
  type: 'runway', defaultBaseUrl: 'https://api.dev.runwayml.com/v1',
  async testConnection(ctx) {
    const response = await send(ctx, { method: 'GET', url: join(ctx.baseUrl, '/organization'), auth: true, headers: headers(ctx) });
    if (response.status === 401 || response.status === 403) return { ok: false, message: 'The provider rejected the credentials.' };
    if (response.status >= 200 && response.status < 300) return { ok: true, message: 'Credentials accepted. No generation was run.' };
    return { ok: false, inconclusive: true, message: `Provider answered HTTP ${response.status}. Run a small paid test to verify.` };
  },
  async generate(ctx, req: AdapterRequest): Promise<AdapterResult> {
    const started = Date.now(), expired = deadline(ctx);
    const ratio = String(req.params?.ratio ?? (req.size ? req.size.replace(/[x*]/, ':') : '1024:1024'));
    const payload: Record<string, unknown> = { model: req.model_id, promptText: req.negative_prompt ? `${req.prompt}\nAvoid: ${req.negative_prompt}` : req.prompt, ratio };
    if (req.seed !== undefined) payload.seed = req.seed;
    if (req.images.length) payload.referenceImages = req.images.map(item => ({ uri: `data:${item.contentType};base64,${item.bytes.toString('base64')}` }));
    const submit = await send(ctx, { method: 'POST', url: join(ctx.baseUrl, '/text_to_image'), auth: true, timeoutMs: 60000, headers: headers(ctx, true), body: JSON.stringify(payload) });
    failIfBad(ctx, submit, 'Runway submit');
    const id = parseJson(submit).id;
    if (typeof id !== 'string') throw new LabError(502, 'LAB_PROVIDER_ERROR', 'Runway did not return a task id.');
    await req.onSubmitted?.(id);
    for (;;) {
      const status = await send(ctx, { method: 'GET', url: join(ctx.baseUrl, `/tasks/${encodeURIComponent(id)}`), auth: true, headers: headers(ctx) });
      failIfBad(ctx, status, 'Runway task');
      const body = parseJson(status);
      if (body.status === 'SUCCEEDED') {
        const url = body.output?.[0];
        if (typeof url !== 'string') throw new LabError(502, 'LAB_OUTPUT_UNAVAILABLE', 'Runway completed without an output image.');
        return { request_id: id, images: [await download(ctx, url)], inference_ms: Date.now() - started };
      }
      if (body.status === 'FAILED' || body.status === 'CANCELLED') throw new LabError(502, 'LAB_PROVIDER_FAILED', `Runway task ${String(body.status).toLowerCase()}${typeof body.failure === 'string' ? `: ${body.failure.slice(0, 160)}` : ''}.`);
      if (expired()) throw new LabError(504, 'LAB_TIMEOUT', `Timed out waiting for Runway task ${id}. It may still run and be billed.`);
      await ctx.sleep(ctx.pollIntervalMs);
    }
  },
};

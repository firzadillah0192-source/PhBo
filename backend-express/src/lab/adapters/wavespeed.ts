import { LabError, type AdapterContext, type AdapterRequest, type AdapterResult, type LabAdapter } from '../types.js';
import { asImage, authHeaders, deadline, download, failIfBad, join, parseJson, send } from './common.js';

// WaveSpeedAI v3 API (docs: /docs-api/wavespeed-ai/qwen-image-edit-plus, /docs/predictions-api).
// Submit: POST {base}/api/v3/{model}; result: GET {base}/api/v3/predictions/{id}/result.
// Statuses: created, processing, completed | failed, cancelled, timeout, deleted. Responses carry no billing fields.
// Input upload uses the media-upload ticket flow of the official SDK (POST /api/v3/media/uploads -> PUT -> download_url).
const FAILED = new Set(['failed', 'cancelled', 'timeout', 'deleted']);
export const wavespeedAdapter: LabAdapter = {
  type: 'wavespeed', defaultBaseUrl: 'https://api.wavespeed.ai',
  async testConnection(ctx) {
    // Authenticated, free, read-only call: history page of size 1.
    const response = await send(ctx, { method: 'POST', url: join(ctx.baseUrl, '/api/v3/predictions'), auth: true,
      headers: { ...authHeaders(ctx), 'Content-Type': 'application/json' }, body: JSON.stringify({ page: 1, page_size: 1 }) });
    if (response.status === 401 || response.status === 403) return { ok: false, message: 'The provider rejected the credentials.' };
    if (response.status >= 200 && response.status < 300) return { ok: true, message: 'Credentials accepted. No generation was run.' };
    return { ok: false, message: `Provider answered HTTP ${response.status}.` };
  },
  async generate(ctx: AdapterContext, req: AdapterRequest): Promise<AdapterResult> {
    const expired = deadline(ctx);
    const urls: string[] = [];
    for (const [index, image] of req.images.entries()) urls.push(await upload(ctx, image.bytes, image.contentType, `lab-${index}.${image.contentType === 'image/png' ? 'png' : image.contentType === 'image/webp' ? 'webp' : 'jpg'}`));
    const payload: Record<string, unknown> = { prompt: req.prompt, images: urls, enable_base64_output: false, enable_sync_mode: false };
    if (req.size) payload.size = req.size;
    if (req.seed !== undefined) payload.seed = req.seed;
    if (req.output_format) payload.output_format = req.output_format;
    const submit = await send(ctx, { method: 'POST', url: join(ctx.baseUrl, `/api/v3/${req.model_id}`), auth: true, headers: { ...authHeaders(ctx), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    failIfBad(ctx, submit, 'WaveSpeed submit');
    let data = parseJson(submit).data ?? {};
    const id = typeof data.id === 'string' ? data.id : null;
    if (!id) throw new LabError(502, 'LAB_PROVIDER_ERROR', 'WaveSpeed did not return a prediction id.');
    while (data.status !== 'completed') {
      if (FAILED.has(data.status)) throw new LabError(502, 'LAB_PROVIDER_FAILED', `WaveSpeed prediction ${data.status}${data.error ? `: ${String(data.error).slice(0, 200)}` : ''}`);
      if (expired()) throw new LabError(504, 'LAB_TIMEOUT', `Timed out waiting for prediction ${id}. It may still run and be billed by the provider.`);
      await ctx.sleep(ctx.pollIntervalMs);
      const poll = await send(ctx, { method: 'GET', url: join(ctx.baseUrl, `/api/v3/predictions/${encodeURIComponent(id)}/result`), auth: true, headers: authHeaders(ctx) });
      failIfBad(ctx, poll, 'WaveSpeed result');
      data = parseJson(poll).data ?? {};
    }
    const outputs: unknown[] = Array.isArray(data.outputs) ? data.outputs : [];
    const first = outputs.find((item): item is string => typeof item === 'string');
    if (!first) throw new LabError(502, 'LAB_OUTPUT_UNAVAILABLE', 'WaveSpeed completed without an output image.');
    const image = first.startsWith('http') ? await download(ctx, first) : await asImage(Buffer.from(first, 'base64'));
    const inference = data.timings && Number.isFinite(data.timings.inference) ? Number(data.timings.inference) : undefined;
    return { request_id: id, images: [image], ...(inference !== undefined ? { inference_ms: inference } : {}) };
  },
};
async function upload(ctx: AdapterContext, bytes: Buffer, contentType: string, filename: string) {
  const ticket = await send(ctx, { method: 'POST', url: join(ctx.baseUrl, '/api/v3/media/uploads'), auth: true, headers: { ...authHeaders(ctx), 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, size: bytes.length, content_type: contentType }) });
  failIfBad(ctx, ticket, 'WaveSpeed upload ticket');
  const data = parseJson(ticket).data ?? {};
  const instruction = data.upload ?? {};
  if (String(instruction.method ?? '').toUpperCase() !== 'PUT' || typeof instruction.url !== 'string' || typeof data.download_url !== 'string')
    throw new LabError(502, 'LAB_PROVIDER_ERROR', 'WaveSpeed returned an unexpected upload instruction.');
  const put = await ctx.http.request({ method: 'PUT', url: instruction.url, headers: instruction.headers && typeof instruction.headers === 'object' ? instruction.headers : { 'Content-Type': contentType }, body: bytes, timeoutMs: 60000 });
  if (put.status < 200 || put.status >= 300) throw new LabError(502, 'LAB_PROVIDER_ERROR', `WaveSpeed upload failed (HTTP ${put.status}).`);
  return data.download_url as string;
}

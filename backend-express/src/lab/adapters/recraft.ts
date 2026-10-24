import { LabError, type AdapterRequest, type AdapterResult, type LabAdapter } from '../types.js';
import { authHeaders, download, failIfBad, join, parseJson, send } from './common.js';
import { multipart } from './openai.js';

// Recraft API: POST /images/generations (JSON) for text-to-image, POST /images/imageToImage (multipart) for one input image.
// imageToImage takes a single image, so templates that need template + face (NXBooth Basic) cannot run here.
export const recraftAdapter: LabAdapter = {
  type: 'recraft', defaultBaseUrl: 'https://external.api.recraft.ai/v1',
  async testConnection(ctx) {
    const response = await send(ctx, { method: 'GET', url: join(ctx.baseUrl, '/users/me'), auth: true, headers: authHeaders(ctx) });
    if (response.status === 401 || response.status === 403) return { ok: false, message: 'The provider rejected the credentials.' };
    if (response.status >= 200 && response.status < 300) return { ok: true, message: 'Credentials accepted. No generation was run.' };
    return { ok: false, inconclusive: true, message: `Provider answered HTTP ${response.status}. Run a small paid test to verify.` };
  },
  async generate(ctx, req: AdapterRequest): Promise<AdapterResult> {
    const started = Date.now();
    if (req.images.length > 1) throw new LabError(422, 'LAB_INPUT_UNSUPPORTED', 'Recraft image-to-image accepts one input image.');
    const prompt = req.negative_prompt ? `${req.prompt}\nAvoid: ${req.negative_prompt}` : req.prompt;
    const fields: Record<string, string> = { prompt, model: req.model_id, response_format: 'url', n: '1' };
    if (req.size) fields.size = req.size.replace('*', 'x');
    if (req.seed !== undefined) fields.random_seed = String(req.seed);
    for (const [key, value] of Object.entries(req.params ?? {})) fields[key] = String(value);
    let response;
    if (!req.images.length) {
      response = await send(ctx, { method: 'POST', url: join(ctx.baseUrl, '/images/generations'), auth: true, timeoutMs: ctx.timeoutMs, headers: { ...authHeaders(ctx), 'Content-Type': 'application/json' }, body: JSON.stringify(fields) });
    } else {
      const image = req.images[0]!;
      const form = multipart({ strength: '0.7', ...fields }, [{ name: 'image', filename: `input.${image.contentType === 'image/png' ? 'png' : image.contentType === 'image/webp' ? 'webp' : 'jpg'}`, type: image.contentType, bytes: image.bytes }]);
      response = await send(ctx, { method: 'POST', url: join(ctx.baseUrl, '/images/imageToImage'), auth: true, timeoutMs: ctx.timeoutMs, headers: { ...authHeaders(ctx), 'Content-Type': form.contentType }, body: form.body });
    }
    failIfBad(ctx, response, 'Recraft generation');
    const url = parseJson(response).data?.[0]?.url;
    if (typeof url !== 'string') throw new LabError(502, 'LAB_OUTPUT_UNAVAILABLE', 'Recraft returned no image.');
    return { request_id: response.headers['x-request-id'] ?? null, images: [await download(ctx, url)], inference_ms: Date.now() - started };
  },
};

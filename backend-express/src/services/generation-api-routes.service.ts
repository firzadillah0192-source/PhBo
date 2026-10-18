import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import sharp from 'sharp';
import { AppError } from '../lib/errors.js';
import { NativeNineRouterProvider, ProviderFailure, type NativeAIProvider, type ProviderImage, type TemplateReference } from './native-provider.service.js';
import { normalizedImageUsage } from './credit-pricing.service.js';

type Lane = 'standard' | 'fast';
type Row = { lane: Lane; enabled: boolean; encrypted_key: string | null; model: string };
const update = z.object({ enabled: z.boolean(), model: z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9_./:-]+$/), api_key: z.string().trim().min(1).max(8192).optional(), clear_key: z.boolean().default(false), confirm: z.literal(true) }).strict();

export class DirectOpenAIImageProvider implements NativeAIProvider {
  readonly name = 'openai';
  constructor(private readonly key: string, private readonly model: string, private readonly fetcher: typeof fetch = fetch) {}
  available() { return Boolean(this.key); }
  async generate(image: Buffer | null, prompt: string, _model: string, template?: TemplateReference): Promise<ProviderImage> {
    if (!this.available()) throw new ProviderFailure('AI_PROVIDER_NOT_CONNECTED', 'Jalur Fast belum terhubung.');
    const fields = { model: this.model, prompt, n: '1', quality: 'low', size: '1024x1536', output_format: 'png' };
    let body: BodyInit, headers: Record<string, string> = { Authorization: `Bearer ${this.key}` };
    if (image) {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) form.append(key, value);
      if (template) form.append('image[]', new Blob([new Uint8Array(template.bytes)], { type: 'image/png' }), 'template.png');
      form.append('image[]', new Blob([new Uint8Array(image)], { type: 'image/jpeg' }), 'portrait.jpg');
      body = form;
    } else { body = JSON.stringify({ ...fields, n: 1 }); headers['Content-Type'] = 'application/json'; }
    let response: Response;
    try { response = await this.fetcher(`https://api.openai.com/v1/images/${image ? 'edits' : 'generations'}`, { method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(180_000) }); }
    catch { throw new ProviderFailure('AI_PROVIDER_ERROR', 'Jalur Fast tidak dapat dihubungi.'); }
    if (!response.ok) { await response.body?.cancel(); throw new ProviderFailure('AI_PROVIDER_ERROR', 'Jalur Fast menolak permintaan.', { http_status: response.status }); }
    let bytes: Buffer, usage: Record<string, number> | null = null;
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const part of response.body ?? []) { size += part.length; if (size > 40 * 1024 * 1024) throw new Error(); chunks.push(Buffer.from(part)); }
      const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const encoded = json.data?.[0]?.b64_json;
      if (typeof encoded !== 'string' || !encoded || !/^[a-zA-Z0-9+/]*={0,2}$/.test(encoded)) throw new Error();
      bytes = Buffer.from(encoded, 'base64');
      if (!bytes.length || bytes.length > 25 * 1024 * 1024) throw new Error();
      const output = sharp(bytes, { limitInputPixels: 25_000_000 }); await output.stats();
      if ((await output.metadata()).format !== 'png') throw new Error();
      usage = normalizedImageUsage(json.usage);
    } catch { throw new ProviderFailure('AI_PROVIDER_ERROR', 'Jalur Fast mengembalikan hasil gambar tidak valid.'); }
    return { bytes, provider: this.name, model: this.model, meta: { ...(usage ?? {}), ...(usage ? { usage } : {}), upstream_status: 'SUCCEEDED', retry_count: 0 } };
  }
}

export class GenerationApiRoutesService {
  private readonly encryptionKey: Buffer;
  constructor(private readonly db: PrismaClient, private readonly config: { sessionSecret: string; baseUrl: string; standardKey: string; timeoutMs: number; resultOrigins: string[] }) {
    // Domain-separated encryption key; session secret must remain stable across a
    // rollout. Rotating it requires re-entering stored routing credentials.
    this.encryptionKey = Buffer.from(hkdfSync('sha256', config.sessionSecret, 'NXBooth route vault', 'generation-api-routes:v1', 32));
  }
  private encrypt(lane: Lane, value: string) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    cipher.setAAD(Buffer.from(lane));
    const content = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), content].map(part => part.toString('base64')).join('.');
  }
  private decrypt(lane: Lane, value: string) {
    try {
      const [iv, tag, content] = value.split('.').map(s => Buffer.from(s, 'base64'));
      const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, iv); decipher.setAAD(Buffer.from(lane)); decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(content), decipher.final()]).toString('utf8');
    } catch { throw new AppError(503, 'API_ROUTE_CREDENTIAL_UNAVAILABLE', 'Kredensial jalur perlu dimasukkan ulang di Admin Console.'); }
  }
  private async row(lane: Lane): Promise<Row> {
    const [row] = await this.db.$queryRaw<Row[]>`SELECT lane,enabled,encrypted_key,model FROM generation_api_routes WHERE lane=${lane}`;
    return row ?? { lane, enabled: lane === 'standard' && Boolean(this.config.standardKey && this.config.baseUrl), encrypted_key: null, model: lane === 'fast' ? 'gpt-image-2.5-flare' : 'cx/gpt-image-2.5' };
  }
  async list() {
    return Promise.all((['standard', 'fast'] as const).map(async lane => {
      const row = await this.row(lane), configured = Boolean(row.encrypted_key || lane === 'standard' && this.config.standardKey && this.config.baseUrl);
      return { lane, enabled: row.enabled, configured, ready: row.enabled && configured, model: row.model, provider: lane === 'fast' ? 'openai' : '9router', credits: lane === 'fast' ? 100 : 50, quality: 'low' };
    }));
  }
  async availability() { return Object.fromEntries((await this.list()).map(row => [row.lane, row.ready])); }
  async save(lane: Lane, body: unknown, actorId: string) {
    const input = update.parse(body);
    if (input.api_key && input.clear_key) throw new AppError(422, 'API_ROUTE_INVALID', 'Pilih mengganti atau menghapus key.');
    if (lane === 'fast' && !/^gpt-image-2\.5-(flare|sunburst)(-\d{4}-\d{2}-\d{2})?$/.test(input.model)) throw new AppError(422, 'API_ROUTE_INVALID', 'Pilih model gambar yang didukung untuk Fast.');
    await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lane},241))::text`;
      const [old] = await tx.$queryRaw<Row[]>`SELECT * FROM generation_api_routes WHERE lane=${lane} FOR UPDATE`;
      const key = input.api_key ? this.encrypt(lane, input.api_key) : input.clear_key ? null : old?.encrypted_key ?? null;
      if (input.enabled && !(key || lane === 'standard' && this.config.standardKey)) throw new AppError(422, 'API_ROUTE_KEY_REQUIRED', 'Isi API key sebelum mengaktifkan jalur.');
      await tx.$executeRaw`INSERT INTO generation_api_routes(lane,enabled,encrypted_key,model) VALUES(${lane},${input.enabled},${key},${input.model}) ON CONFLICT(lane) DO UPDATE SET enabled=EXCLUDED.enabled,encrypted_key=EXCLUDED.encrypted_key,model=EXCLUDED.model,updated_at=now()`;
      await tx.nxAuditLog.create({ data: { id: randomBytes(16).toString('hex'), admin_actor_id: actorId, action: 'generation_api_route.updated', target_type: 'generation_api_route', target_id: lane, reason: 'Admin updated generation route', metadata_json: JSON.stringify({ enabled: input.enabled, model: input.model, key_changed: Boolean(input.api_key || input.clear_key) }) } });
    });
    return (await this.list()).find(row => row.lane === lane)!;
  }
  async provider(lane: Lane): Promise<NativeAIProvider> {
    const row = await this.row(lane);
    const key = row.encrypted_key ? this.decrypt(lane, row.encrypted_key) : lane === 'standard' ? this.config.standardKey : '';
    if (!row.enabled || !key) throw new AppError(503, 'AI_PROVIDER_NOT_CONNECTED', 'Jalur generate yang dipilih belum terhubung.');
    if (lane === 'fast') return new DirectOpenAIImageProvider(key, row.model);
    const base = new NativeNineRouterProvider({ baseUrl: this.config.baseUrl, key, timeoutMs: this.config.timeoutMs, resultOrigins: this.config.resultOrigins });
    return { name: base.name, available: () => base.available(), generate: (image, prompt, _model, template) => base.generate(image, prompt, row.model, template, 'low') };
  }
  async forJob(jobId: string) {
    const [job] = await this.db.$queryRaw<{ lane: 'classic' | Lane }[]>`SELECT lane FROM subscription_v2_jobs WHERE job_id=${jobId}`;
    return job && job.lane !== 'classic' ? this.provider(job.lane) : null;
  }
}

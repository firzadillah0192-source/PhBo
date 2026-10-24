import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import { NativeNineRouterProvider, type NativeAIProvider } from './native-provider.service.js';

type Lane = 'standard' | 'fast';
type Row = { lane: Lane; enabled: boolean; encrypted_key: string | null; model: string };
const update = z.object({ enabled: z.boolean(), model: z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9_./:-]+$/), api_key: z.string().trim().min(1).max(8192).optional(), clear_key: z.boolean().default(false), confirm: z.literal(true) }).strict();

// Distinguish new Fast gateway credentials from legacy direct-OpenAI keys.
const FAST_ROUTER_KEY_PREFIX = '9router:v1:';

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
    const value = row ?? { lane, enabled: lane === 'standard' && Boolean(this.config.standardKey && this.config.baseUrl), encrypted_key: null, model: lane === 'fast' ? 'openai/gpt-image-2.5-flare' : 'cx/gpt-image-2.5' };
    // Existing Fast rows used bare OpenAI model IDs; no database rewrite is needed.
    return lane === 'fast' && !value.model.includes('/') ? { ...value, model: `openai/${value.model}` } : value;
  }
  async list() {
    return Promise.all((['standard', 'fast'] as const).map(async lane => {
      const row = await this.row(lane), standard = lane === 'standard' ? row : await this.row('standard');
      const ownKey = lane === 'standard' ? row.encrypted_key : row.encrypted_key?.startsWith(FAST_ROUTER_KEY_PREFIX);
      const configured = Boolean(this.config.baseUrl && (ownKey || standard.encrypted_key || this.config.standardKey));
      return { lane, enabled: row.enabled, configured, ready: row.enabled && configured, model: row.model, provider: '9router', credits: lane === 'fast' ? 100 : 50, quality: 'low' };
    }));
  }
  async availability() { return Object.fromEntries((await this.list()).map(row => [row.lane, row.ready])); }
  async save(lane: Lane, body: unknown, actorId: string) {
    const input = update.parse(body);
    if (input.api_key && input.clear_key) throw new AppError(422, 'API_ROUTE_INVALID', 'Pilih mengganti atau menghapus key.');
    if (lane === 'fast' && !/^openai\/(?:gpt-image-[a-zA-Z0-9_.-]+|chatgpt-image-latest)$/.test(input.model)) throw new AppError(422, 'API_ROUTE_INVALID', 'Model Fast harus memakai awalan openai/, misalnya openai/gpt-image-2.5-flare.');
    if (lane === 'standard' && !input.model.startsWith('cx/')) throw new AppError(422, 'API_ROUTE_INVALID', 'Model Standard harus memakai awalan cx/.');
    const standard = lane === 'fast' ? await this.row('standard') : null;
    await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lane},241))::text`;
      const [old] = await tx.$queryRaw<Row[]>`SELECT * FROM generation_api_routes WHERE lane=${lane} FOR UPDATE`;
      const key = input.api_key ? (lane === 'fast' ? FAST_ROUTER_KEY_PREFIX : '') + this.encrypt(lane, input.api_key) : input.clear_key ? null : old?.encrypted_key ?? null;
      const ownKey = lane === 'standard' ? key : key?.startsWith(FAST_ROUTER_KEY_PREFIX);
      if (input.enabled && !(this.config.baseUrl && (ownKey || standard?.encrypted_key || this.config.standardKey))) throw new AppError(422, 'API_ROUTE_KEY_REQUIRED', 'Isi API key sebelum mengaktifkan jalur.');
      await tx.$executeRaw`INSERT INTO generation_api_routes(lane,enabled,encrypted_key,model) VALUES(${lane},${input.enabled},${key},${input.model}) ON CONFLICT(lane) DO UPDATE SET enabled=EXCLUDED.enabled,encrypted_key=EXCLUDED.encrypted_key,model=EXCLUDED.model,updated_at=now()`;
      await tx.nxAuditLog.create({ data: { id: randomBytes(16).toString('hex'), admin_actor_id: actorId, action: 'generation_api_route.updated', target_type: 'generation_api_route', target_id: lane, reason: 'Admin updated generation route', metadata_json: JSON.stringify({ enabled: input.enabled, model: input.model, key_changed: Boolean(input.api_key || input.clear_key) }) } });
    });
    return (await this.list()).find(row => row.lane === lane)!;
  }
  async provider(lane: Lane): Promise<NativeAIProvider> {
    const row = await this.row(lane);
    if (!row.model.startsWith(lane === 'fast' ? 'openai/' : 'cx/')) throw new AppError(503, 'API_ROUTE_INVALID', 'Model jalur generate perlu diperbarui di Admin Console.');
    const standard = lane === 'standard' ? row : await this.row('standard');
    // Never send an old direct-OpenAI key to the gateway. Fast inherits the Standard
    // gateway credential unless a new gateway key was explicitly saved for Fast.
    const ownKey = lane === 'fast' && row.encrypted_key?.startsWith(FAST_ROUTER_KEY_PREFIX)
      ? this.decrypt('fast', row.encrypted_key.slice(FAST_ROUTER_KEY_PREFIX.length)) : null;
    const key = ownKey ?? (standard.encrypted_key ? this.decrypt('standard', standard.encrypted_key) : this.config.standardKey);
    if (!row.enabled || !key || !this.config.baseUrl) throw new AppError(503, 'AI_PROVIDER_NOT_CONNECTED', 'Jalur generate yang dipilih belum terhubung.');
    const base = new NativeNineRouterProvider({ baseUrl: this.config.baseUrl, key, timeoutMs: this.config.timeoutMs, resultOrigins: this.config.resultOrigins });
    return { name: base.name, available: () => base.available(), generate: (image, prompt, _model, template) => base.generate(image, prompt, row.model, template, 'low') };
  }
  async forJob(jobId: string) {
    const [job] = await this.db.$queryRaw<{ lane: 'classic' | Lane }[]>`SELECT lane FROM subscription_v2_jobs WHERE job_id=${jobId}`;
    return job && job.lane !== 'classic' ? this.provider(job.lane) : null;
  }
}

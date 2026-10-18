import { STANDARD_AI_CREDITS_PER_RESULT } from '../services/subscription-policy.service.js';
import type { PhotoFolderService } from '../services/photo-folder.service.js';
import { Router, type Request, type RequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import type { CustomerCatalogService } from '../services/customer-catalog.service.js';
import type { CustomerUploadService } from '../services/customer-upload.service.js';
import type { CustomerGenerationService } from '../services/customer-generation.service.js';
import type { CustomerResultService } from '../services/customer-result.service.js';
import type { CustomerIdentity } from '../services/customer-account.service.js';
import type { PublicApiKeyModel } from '../models/public-api-key.model.js';
import type { PublicApiKeyService, PublicApiPrincipal, PublicApiScope } from '../services/public-api-key.service.js';

export const publicApiBase = '/api/public/v1';
export type PublicApiDeps = {
  keys: PublicApiKeyService; keyModel: Pick<PublicApiKeyModel, 'resultIds'>;
  catalog: Pick<CustomerCatalogService, 'templates'>; uploads: Pick<CustomerUploadService, 'create' | 'owned' | 'response'>;
  generations: Pick<CustomerGenerationService, 'create' | 'status'>; results: Pick<CustomerResultService, 'owned' | 'metadata' | 'rendition'>;
  maxUploadBytes: number; folders?:PhotoFolderService; generationEnabled?: boolean;
  /** Fixed-window counter shared across instances (Redis); falls back to process memory if it throws. */
  window?: (key: string, seconds: number) => Promise<number>;
};
type Authed = Request & { principal?: PublicApiPrincipal };
const param = (req: Request, name: string) => String(req.params[name]);

const generationBody = z.object({
  folder_id:z.string().regex(/^[a-f0-9]{32}$/).nullable().optional(),
  template_id: z.string().min(1).max(128), input_id: z.string().min(1).max(32),
}).strict();
const encodeCursor = (at: Date, id: string) => Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
function decodeCursor(value: unknown) {
  if (value === undefined) return null;
  const match = typeof value === 'string' && /^([^|]+)\|([a-f0-9]{32})$/.exec(Buffer.from(value, 'base64url').toString());
  const at = match ? new Date(match[1]) : null;
  if (!match || !at || Number.isNaN(at.getTime())) throw new AppError(422, 'CURSOR_INVALID', 'Invalid cursor.');
  return { at, id: match[2] };
}

export function publicApiRoutes(deps: PublicApiDeps) {
  const router = Router(), local = new Map<string, { count: number; expires: number }>();
  const count = async (key: string) => {
    try { if (deps.window) return await deps.window(key, 60); } catch { /* use the local window below */ }
    const now = Date.now();
    for (const [id, value] of local) if (value.expires <= now) local.delete(id);
    const value = local.get(key) ?? { count: 0, expires: now + 60000 };
    value.count += 1; local.set(key, value);
    return value.count;
  };
  const auth = (scope: PublicApiScope, bucket: string, maximum: number, generation = false): RequestHandler => async (req: Authed, res, next) => {
    const principal = await deps.keys.authenticate(req.get('Authorization'));
    deps.keys.require(principal, scope);
    if (await count(`photobooth:publicapi:${bucket}:${principal.key.id}`) > maximum) {
      res.set('Retry-After', '60').status(429).json({ detail: { error_code: 'RATE_LIMITED', message: 'Too many requests. Retry after the indicated delay.' } }); return;
    }
    deps.keys.record(principal, generation);
    req.principal = principal; next();
  };
  const identity = (req: Authed): CustomerIdentity => ({ account: req.principal!.account, guest: null, clearAccount: false, newGuest: null, sessionId: `api:${req.principal!.key.id}` });
  // Authenticated responses are private to the caller.
  router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

  const template = (row: Awaited<ReturnType<CustomerCatalogService['templates']>>['templates'][number]) => ({
    id: row.id, name: row.name, description: row.description, mode: 'BASIC', preview_url: row.preview_url, width: row.width, height: row.height,
    input: { photos: 1, max_bytes: deps.maxUploadBytes }, credit_cost: STANDARD_AI_CREDITS_PER_RESULT });
  const available = async () => (await deps.catalog.templates()).templates.filter(row => row.enabled && row.basic_available);
  router.get('/templates', auth('catalog:read', 'read', 120), async (_req, res) => { const rows = (await available()).map(template); res.json({ templates: rows, count: rows.length }); });
  router.get('/templates/:id', auth('catalog:read', 'read', 120), async (req, res) => {
    const row = (await available()).find(item => item.id === param(req, 'id'));
    if (!row) throw new AppError(404, 'TEMPLATE_NOT_FOUND', 'Template unavailable.');
    res.json(template(row));
  });

  if (deps.generationEnabled) {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: deps.maxUploadBytes, files: 1, fields: 2 } }).single('file');
  router.post('/inputs', auth('inputs:write', 'write', 20), upload, async (req: Authed, res) => {
    const input = await deps.uploads.create(req.file, identity(req));
    res.status(201).json({ input_id: input.upload_id, content_type: input.normalized_content_type, size_bytes: input.size_bytes,
      width: input.width, height: input.height, created_at: input.created_at, expires_at: input.expires_at });
  });

  const job = (value: Awaited<ReturnType<CustomerGenerationService['create']>>) => ({ job_id: value.job_id, state: value.state, template_id: value.template_id, created_at: value.created_at });
  router.post('/generations', auth('generations:create', 'write', 20, true), async (req: Authed, res) => {
    const key = req.get('Idempotency-Key');
    if (!key) throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'The Idempotency-Key header is required.');
    if (key.length > 120) throw new AppError(400, 'IDEMPOTENCY_KEY_INVALID', 'Invalid generation request key');
    const body = generationBody.parse(req.body);
    // The prefix keeps API retries from colliding with keys the same account used on the website.
    res.status(202).json(job(await deps.generations.create({ mode: 'BASIC', upload_id: body.input_id, template_id: body.template_id,
      ...(body.folder_id!==undefined?{folder_id:body.folder_id}:{}) }, identity(req), `pub_${key}`)));
  });
  router.get('/generations/:id', auth('generations:read', 'read', 120), async (req: Authed, res) => {
    const status = await deps.generations.status(param(req, 'id'), identity(req));
    if (!['COMPLETED', 'FAILED'].includes(status.state)) res.set('Retry-After', '3');
    // Explicit allow-list: no provider, model, error text or pricing calculation.
    res.json({ ...job(status), input_id: status.upload_id, updated_at: status.updated_at, started_at: status.started_at, finished_at: status.finished_at,
      error_code: status.error_code ?? null, result_id: status.result_id ?? null,
      credit_charge: status.credit_charge ? { status: status.credit_charge.status, credits: status.credit_charge.credits } : null });
  });

  }

  const result = (found: Awaited<ReturnType<CustomerResultService['owned']>>) => {
    const meta = deps.results.metadata(found);
    return { result_id: meta.result_id, job_id: meta.job_id, template_id: meta.template_id, content_type: meta.content_type, size_bytes: meta.size_bytes,
      width: meta.width, height: meta.height, sha256: meta.sha256, download_url: `${publicApiBase}/results/${meta.result_id}/download`,
      created_at: meta.created_at, expires_at: meta.expires_at };
  };
  router.get('/results', auth('results:read', 'read', 120), async (req: Authed, res) => {
    const limit = z.coerce.number().int().min(1).max(50).default(20).parse(req.query.limit);
    const rows = await deps.keyModel.resultIds(req.principal!.account.id, decodeCursor(req.query.cursor), limit + 1);
    const page = rows.slice(0, limit), items = [];
    // Ownership, retention and payment state are enforced by the same check the website uses; expired results are skipped.
    for (const row of page) { try { items.push(result(await deps.results.owned(row.id, identity(req)))); } catch (error) { if (!(error instanceof AppError) || error.status >= 500) throw error; } }
    const last = page.at(-1);
    res.json({ results: items, next_cursor: rows.length > limit && last ? encodeCursor(last.created_at, last.id) : null });
  });
  router.get('/results/:id', auth('results:read', 'read', 120), async (req: Authed, res) => { res.json(result(await deps.results.owned(param(req, 'id'), identity(req)))); });
  router.get('/results/:id/download', auth('results:read', 'read', 60), async (req: Authed, res) => {
    const found = await deps.results.owned(param(req, 'id'), identity(req));
    const bytes = await deps.results.rendition(found, false);
    res.type(found.result.content_type).set('Content-Disposition', `attachment; filename="nxbooth-${found.result.id}.png"`).send(bytes);
  });

  if(deps.folders){
    router.get('/storage/folders',auth('results:read','read',120),async(req:Authed,res)=>{res.json(await deps.folders!.list(req.principal!.account.id));});
    router.get('/storage/photos',auth('results:read','read',120),async(req:Authed,res)=>{res.json(await deps.folders!.photos(req.principal!.account.id,req.query,`${publicApiBase}/storage/photos`));});
    for(const mode of ['image','download']) router.get(`/storage/photos/:id/${mode}`,auth('results:read','read',60),async(req:Authed,res)=>{
      const found=await deps.results.owned(param(req,'id'),identity(req));
      if(mode==='download')res.attachment(`nxbooth-${found.result.id}.png`);
      res.type(found.result.content_type).send(await deps.results.rendition(found,false));
    });
  }
  router.get('/usage', auth('usage:read', 'read', 60), async (req: Authed, res) => {
    const { key } = req.principal!;
    res.json({ key: deps.keys.view(key), daily: await deps.keys.usage(req.principal!) });
  });
  return router;
}

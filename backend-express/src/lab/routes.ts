import { Router, type Request, type RequestHandler } from 'express';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { AdminAuthService } from '../services/admin-auth.service.js';
import { LabError } from './types.js';
import type { Actor, LabService, RunInput } from './service.js';

const limiter = (limit: number) => rateLimit({ windowMs: 60_000, limit, standardHeaders: 'draft-8', legacyHeaders: false, message: { detail: { error_code: 'RATE_LIMITED', message: 'Too many Lab requests. Slow down.' } } });
const id = (req: Request, key = 'id') => z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/).parse(req.params[key]);
const query = (req: Request) => Object.fromEntries(Object.entries(req.query).filter(([, v]) => typeof v === 'string' && v.length < 100)) as Record<string, string>;
const scenarioSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('basic'), template_id: z.string().min(1).max(128) }).strict(),
  z.object({ kind: z.literal('advanced'), experience_id: z.string().min(1).max(128), frame_style_id: z.string().min(1).max(128) }).strict(),
]);
const runPayload = z.object({ scenario: scenarioSchema.optional(),
  model_ref: z.string().min(1).max(64), prompt: z.string().max(4000).default(''), negative_prompt: z.string().max(2000).optional(), size: z.string().max(24).optional(), quality: z.string().max(24).optional(),
  seed: z.number().int().optional(), output_format: z.string().max(12).optional(), confirm: z.boolean().optional(), confirmed_estimate_usd: z.number().nullable().optional(),
  acknowledge_unknown_cost: z.boolean().optional(), override_reason: z.string().max(300).optional(),
}).strict();
const comparePayload = runPayload.omit({ model_ref: true, confirmed_estimate_usd: true }).extend({ model_refs: z.array(z.string().min(1).max(64)).min(2).max(6), confirmed_total_usd: z.number().nullable().optional(), name: z.string().max(120).optional() }).strict();

// Every endpoint is superadmin-only and enforced server-side. Lab spends real provider money.
export function labRoutes(auth: AdminAuthService, lab: LabService, maxUpload: number) {
  const router = Router();
  const guard = async (req: Request): Promise<Actor> => { const actor = await auth.resolve(req.cookies || {}, req.get('x-admin-token')); auth.requireRole(actor, 'superadmin'); return actor; };
  const act = (fn: (req: Request, actor: Actor) => Promise<unknown>, status = 200): RequestHandler => async (req, res) => {
    const actor = await guard(req), data = await fn(req, actor);
    if (status === 204) res.status(204).end(); else res.status(status).json(data);
  };
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxUpload, files: 6, fields: 4, fieldSize: 16 * 1024 } })
    .fields([{ name: 'face', maxCount: 1 }, { name: 'template', maxCount: 1 }, { name: 'reference', maxCount: 1 }, { name: 'extra', maxCount: 4 }]);
  const authorizedUpload: RequestHandler = async (req, res, next) => { try { await guard(req); upload(req, res, next); } catch (error) { next(error); } };
  const parsed = <T extends z.ZodType>(req: Request, schema: T): z.output<T> => {
    try { return schema.parse(JSON.parse(String(req.body?.payload ?? ''))); } catch (error) { if (error instanceof z.ZodError) throw error; throw new LabError(422, 'LAB_PAYLOAD_INVALID', 'Request payload is not valid JSON.'); }
  };
  const images = (req: Request): RunInput['images'] => {
    const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>, out: RunInput['images'] = [];
    for (const [field, role] of [['template', 'template'], ['reference', 'reference'], ['extra', 'extra']] as const) for (const file of files[field] ?? []) out.push({ bytes: file.buffer, role });
    return out;
  };
  router.get('/overview', act(async () => ({ encryption_ready: lab.encryptionReady, settings: await lab.settings(), budget: await lab.budget(), providers: await lab.listProviders(), models: await lab.listModels(), isolation: { production_routing_changed: false, note: 'Lab configuration, credentials and records are stored separately from production.' } })));
  router.get('/settings', act(() => lab.settings()));
  router.put('/settings', limiter(20), act((req, a) => lab.updateSettings(req.body, a)));
  router.get('/providers', act(() => lab.listProviders()));
  router.post('/providers', limiter(20), act((req, a) => lab.createProvider(req.body, a), 201));
  router.patch('/providers/:id', limiter(30), act((req, a) => lab.updateProvider(id(req), req.body, a)));
  router.delete('/providers/:id', limiter(20), act((req, a) => lab.deleteProvider(id(req), a), 204));
  router.put('/providers/:id/credential', limiter(10), act((req, a) => lab.setCredential(id(req), req.body?.secret, a)));
  router.delete('/providers/:id/credential', limiter(10), act((req, a) => lab.removeCredential(id(req), a)));
  router.post('/providers/:id/test', limiter(10), act((req, a) => lab.testConnection(id(req), a)));
  router.get('/models', act(() => lab.listModels()));
  router.post('/models', limiter(30), act((req, a) => lab.saveModel(null, req.body, a), 201));
  router.patch('/models/:id', limiter(30), act((req, a) => lab.saveModel(id(req), req.body, a)));
  router.delete('/models/:id', limiter(20), act((req, a) => lab.deleteModel(id(req), a), 204));
  router.post('/estimate', limiter(60), act(req => lab.estimateFor(req.body)));
  // Scenario mode (Basic/Advanced): the server builds the prompt and prepares images exactly as production does.
  const faceOf = (req: Request) => { const f = ((req.files ?? {}) as Record<string, Express.Multer.File[]>).face?.[0]; if (!f) throw new LabError(422, 'LAB_FACE_REQUIRED', 'Upload a customer face photo for Basic/Advanced scenarios.'); return f.buffer; };
  const withScenario = async <T extends { prompt: string }>(req: Request, scenario: z.output<typeof scenarioSchema> | undefined, base: T) => {
    if (!scenario) { if (!base.prompt.trim()) throw new LabError(422, 'LAB_PROMPT_REQUIRED', 'Enter a prompt.'); return { ...base, images: images(req) }; }
    const plan = await lab.planScenario(scenario, faceOf(req));
    return { ...base, prompt: plan.prompt, negative_prompt: undefined, scenario: plan, images: plan.images };
  };
  router.get('/scenarios', act(() => lab.scenarioCatalog()));
  router.post('/runs', limiter(10), authorizedUpload, act(async (req, actor) => {
    const p = parsed(req, runPayload), { confirm, confirmed_estimate_usd, acknowledge_unknown_cost, override_reason, scenario, ...rest } = p;
    const input = await withScenario(req, scenario, rest);
    const { runs } = await lab.createRuns([input], actor, { confirm, total_usd: confirmed_estimate_usd ?? null, acknowledge_unknown_cost, override_reason });
    return lab.runView(runs[0]!.id);
  }, 202));
  router.post('/compare', limiter(5), authorizedUpload, act(async (req, actor) => {
    const { model_refs, confirm, confirmed_total_usd, acknowledge_unknown_cost, override_reason, name, scenario, ...rest } = parsed(req, comparePayload);
    const shared = await withScenario(req, scenario, rest); // prepared once, identical for every model
    const created = await lab.createRuns(model_refs.map(model_ref => ({ ...shared, model_ref })), actor, { confirm, total_usd: confirmed_total_usd ?? null, acknowledge_unknown_cost, override_reason });
    return lab.saveSession({ name: name || `Comparison ${new Date().toISOString().slice(0, 16)}`, run_ids: created.runs.map(r => r.id) }, actor);
  }, 202));
  router.get('/runs', act(req => lab.listRuns(query(req))));
  router.get('/runs/:id', act(req => lab.runView(id(req))));
  router.delete('/runs/:id/files', limiter(30), act((req, a) => lab.deleteRunFiles(id(req), a), 204));
  router.post('/runs/:id/rating', limiter(60), act((req, a) => lab.rate(id(req), req.body, a)));
  router.get('/runs/:id/image/:slot', async (req, res) => {
    await guard(req);
    const file = await lab.runFile(id(req), id(req, 'slot'));
    res.type(file.contentType).set('Cache-Control', 'private, no-store'); if (req.query.download === '1') res.attachment(file.name);
    res.send(file.bytes);
  });
  router.get('/sessions', act(() => lab.listSessions()));
  router.post('/sessions', limiter(30), act((req, a) => lab.saveSession(req.body, a), 201));
  router.get('/sessions/:id', act(req => lab.getSession(id(req))));
  router.get('/benchmarks', act(req => lab.benchmarks(query(req), Number(req.query.threshold) || 4)));
  router.get('/candidates', act(() => lab.listCandidates()));
  router.post('/candidates', limiter(20), act((req, a) => lab.markCandidate(req.body, a), 201));
  router.get('/analytics', act(req => lab.analytics(query(req))));
  router.get('/export.csv', async (req, res) => { await guard(req); res.type('text/csv').attachment('nxbooth-lab-benchmarks.csv').send(await lab.exportCsv(query(req))); });
  router.post('/purge', limiter(5), act(() => lab.purgeExpired()));
  // Router-local error mapping for Lab errors; everything else falls through to the app handler.
  router.use((error: unknown, _req: Request, res: import('express').Response, next: import('express').NextFunction) => {
    if (error instanceof LabError) { res.status(error.status).json({ detail: { error_code: error.code, message: error.message } }); return; }
    next(error);
  });
  return router;
}

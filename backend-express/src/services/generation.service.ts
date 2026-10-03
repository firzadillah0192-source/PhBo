import type { Generation } from '@prisma/client';
import type { GenerationModel } from '../models/generation.model.js';
import type { FrameModel } from '../models/frame.model.js';
import type { CreateGenerationInput } from '../objects/requests.js';
import type { BrowserId, Repository } from '../types/domain.js';
import type { PhotoSessionService } from './photo-session.service.js';
import type { StorageService } from './storage.service.js';
import { ensure } from '../lib/errors.js';
import { generationObject } from '../objects/responses.js';
import type { GenerationEngineService } from './generation-engine.service.js';

export class GenerationService {
  constructor(
    private readonly model: Repository<Pick<GenerationModel, 'find' | 'list' | 'findRequest' | 'create'>>,
    private readonly frames: Repository<Pick<FrameModel, 'find'>>,
    private readonly sessions: Pick<PhotoSessionService, 'require'>,
    private readonly storage: Pick<StorageService, 'url'>,
    private readonly ai?: Pick<GenerationEngineService, 'assertConfigured'> & Partial<Pick<GenerationEngineService, 'snapshot' | 'listExperiences'>>,
  ) {}
  async present(job: Generation, expiresAt: Date) { return generationObject(job, job.objectId ? await this.storage.url(job.objectId, expiresAt) : null); }
  async create(input: CreateGenerationInput, requestKey: string, browserId: BrowserId) {
    const session = await this.sessions.require(input.sessionCode, browserId);
    const photos = session.photos ?? (session.photo ? [session.photo] : []);
    const selected = input.photoIds ?? (input.mode === 'CLASSIC' ? photos.map(photo => photo.id) : photos.slice(0, 1).map(photo => photo.id));
    ensure(selected.length >= 1 && selected.length <= (input.mode === 'CLASSIC' ? 4 : 1), 400, 'PHOTO_COUNT', 'CLASSIC accepts 1–4 photos; other modes accept one');
    ensure(selected.every(id => photos.some(photo => photo.id === id)), 403, 'PHOTO_FORBIDDEN', 'Selected photos must belong to this session');
    ensure(selected.length === 1 || input.frameId, 400, 'FRAME_REQUIRED', 'Select a frame for multiple photos');
    const selectionInput = { ...input, photoIds: selected };
    const prior = await this.model.findRequest(session.id, requestKey);
    if (prior) return this.replay(prior, selectionInput, session.expiresAt);
    ensure(this.ai, 503, 'AI_UNAVAILABLE', 'AI engine is not configured');
    this.ai.assertConfigured(input.mode);
    if (input.frameId) ensure((await this.frames.find(input.frameId))?.active, 404, 'FRAME_NOT_FOUND', 'Frame not found');
    const job = await this.model.create(session, { mode: input.mode, frameId: input.frameId ?? null, requestKey,
      templateId: input.templateId ?? null, experienceId: input.experienceId ?? null,
      photoIds: selected,
      engineConfig: this.ai.snapshot?.(input) });
    return this.replay(job, selectionInput, session.expiresAt);
  }
  replay(job: Generation, input: CreateGenerationInput, expiresAt: Date) {
    ensure(job.mode === input.mode && job.frameId === (input.frameId ?? null)
      && (job.templateId ?? null) === (input.templateId ?? null) && (job.experienceId ?? null) === (input.experienceId ?? null),
      409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key was used for a different request');
    ensure(!input.photoIds || JSON.stringify(job.photoIds) === JSON.stringify(input.photoIds),
      409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key was used for different photos');
    return this.present(job, expiresAt);
  }
  async get(id: string, browserId: BrowserId) {
    const job = await this.model.find(id);
    ensure(job, 404, 'GENERATION_NOT_FOUND', 'Generation not found');
    await this.sessions.require(job.sessionId, browserId);
    return this.present(job, job.session.expiresAt);
  }
  async list(codeOrId: string, browserId: BrowserId) {
    const session = await this.sessions.require(codeOrId, browserId);
    return Promise.all((await this.model.list(session.id)).map((job) => this.present(job, session.expiresAt)));
  }
  listExperiences() { return this.ai?.listExperiences?.() ?? []; }
}

import type { PrismaClient, Prisma } from '@prisma/client';
import { CreditAccountingModel } from './credit-accounting.model.js';
import { legacyId } from '../services/customer-credentials.service.js';
import { WorkerLeaseModel } from './worker-lease.model.js';
import type { GenerationRequest } from '../services/generation-request.js';
import { AppError } from '../lib/errors.js';
import type { KioskGenerationContext } from './native-kiosk.model.js';

export class CustomerGenerationModel {
  private readonly credits: CreditAccountingModel;
  readonly leases: WorkerLeaseModel;
  constructor(private readonly db: PrismaClient,private readonly maxWorkerAttempts = 3) { this.credits = new CreditAccountingModel(db); this.leases = new WorkerLeaseModel(db); }
  template(id: string) { return this.db.nxTemplate.findUnique({ where: { id } }); }
  layout(id: string) { return this.db.nxClassicLayout.findUnique({ where: { id } }); }
  experience(id: string) { return this.db.nxExperience.findUnique({ where: { id } }); }
  frame(id: string) { return this.db.nxFrameStyle.findUnique({ where: { id } }); }
  ornaments(ids: string[]) { return this.db.nxOrnament.findMany({ where: { id: { in: ids } } }); }
  find(id: string) { return this.db.nxGenerationJob.findUnique({ where: { id } }); }
  result(job_id: string) { return this.db.nxResult.findFirst({ where: { job_id, deleted_at: null } }); }
  async eventSlugForJob(jobId: string) {
    const rows=await this.db.$queryRaw<{slug:string}[]>`SELECT e.slug FROM generation_jobs j JOIN events e ON e.id=j.event_id WHERE j.id=${jobId}`;
    return rows[0]?.slug ?? null;
  }
  private async requestIn(tx: Prisma.TransactionClient, request: GenerationRequest) {
    const rows = await tx.$queryRaw<{ request_hash: string; job_id: string }[]>`SELECT request_hash,job_id FROM generation_requests
      WHERE owner_scope=${request.scope} AND request_key=${request.key}`;
    if (!rows.length) return null;
    if (rows[0].request_hash !== request.hash) throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'This request key was already used with different selections');
    return tx.nxGenerationJob.findUniqueOrThrow({ where: { id: rows[0].job_id } });
  }
  findRequest(request: GenerationRequest) { return this.db.$transaction(tx => this.requestIn(tx, request)); }
  createOnce(data: Prisma.NxGenerationJobCreateInput, request: GenerationRequest, kiosk?: KioskGenerationContext) {
    return this.db.$transaction(async tx => {
      // Serialize retries from the same owner and key before reserving credit.
      // Hash collisions only serialize unrelated requests; the full key is checked.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${request.scope + ':' + request.key},0))::text`;
      const existing = await this.requestIn(tx, request);
      if (existing) return { job: existing, reused: true };
      const job = await this.createIn(tx, data, kiosk);
      await tx.$executeRaw`INSERT INTO generation_requests(owner_scope,request_key,request_hash,job_id)
        VALUES (${request.scope},${request.key},${request.hash},${job.id})`;
      return { job, reused: false };
    });
  }
  create(data: Prisma.NxGenerationJobCreateInput) {
    return this.db.$transaction(tx => this.createIn(tx, data));
  }
  private async createIn(tx: Prisma.TransactionClient, data: Prisma.NxGenerationJobCreateInput, kiosk?: KioskGenerationContext) {
      let eventId: string | null = null;
      if (kiosk) {
        const sessions = await tx.$queryRaw<{ event_id: string | null; capture_upload_ids_json: string }[]>`SELECT event_id,capture_upload_ids_json FROM kiosk_sessions
          WHERE id=${kiosk.id} AND guest_id=${kiosk.guestId} AND status='ACTIVE' AND claimed_at IS NOT NULL AND expires_at>now() FOR UPDATE`;
        if (!sessions.length || data.guest_id !== kiosk.guestId || data.account_id) throw new AppError(410, 'SESSION_EXPIRED', 'Photo session unavailable');
        const allowed = new Set<string>(JSON.parse(sessions[0].capture_upload_ids_json));
        const captures: string[] = data.mode === 'CLASSIC' ? JSON.parse(String(data.capture_upload_ids_json)) : [String(data.upload_id)];
        if (captures.some(id => !allowed.has(id))) throw new AppError(403, 'PHOTO_FORBIDDEN', 'Photo does not belong to session');
        eventId = sessions[0].event_id;
        if (eventId) {
          const events = await tx.$queryRaw<{ classic_enabled: boolean; basic_enabled: boolean; advanced_enabled: boolean; classic_layout_id: string | null }[]>`SELECT classic_enabled,basic_enabled,advanced_enabled,classic_layout_id FROM events
            WHERE id=${eventId} AND status='published' AND (starts_at IS NULL OR starts_at<=now()) AND (ends_at IS NULL OR ends_at>now())`;
          const event = events[0];
          const enabled = event && (data.mode === 'CLASSIC' ? event.classic_enabled : data.mode === 'BASIC' ? event.basic_enabled : event.advanced_enabled);
          if (!enabled) throw new AppError(403, 'EVENT_MODE_UNAVAILABLE', 'This mode is unavailable for the event');
          if (data.mode === 'CLASSIC' && event.classic_layout_id && data.layout_id !== event.classic_layout_id)
            throw new AppError(403, 'EVENT_LAYOUT_UNAVAILABLE', 'Frame unavailable for the event');
          if (data.mode === 'BASIC') {
            const items = await tx.$queryRaw<{ template_id: string }[]>`SELECT template_id FROM event_basic_templates WHERE event_id=${eventId} AND enabled=true AND template_id=${String(data.template_id)}`;
            if (!items.length) throw new AppError(403, 'EVENT_TEMPLATE_UNAVAILABLE', 'Template unavailable for the event');
          }
          if (data.mode === 'ADVANCED') {
            const items = await tx.$queryRaw<{ experience_id: string }[]>`SELECT experience_id FROM event_advanced_experiences WHERE event_id=${eventId} AND enabled=true AND experience_id=${String(data.experience_id)}`;
            if (!items.length) throw new AppError(403, 'EVENT_EXPERIENCE_UNAVAILABLE', 'Experience unavailable for the event');
          }
        }
      }
      const job = await tx.nxGenerationJob.create({ data });
      if (kiosk) await tx.$executeRaw`UPDATE generation_jobs SET kiosk_session_id=${kiosk.id},event_id=${eventId} WHERE id=${job.id}`;
      if (job.account_id) await tx.nxAccount.update({ where: { id: job.account_id }, data: { last_activity_at: new Date() } });
      if (job.mode === 'BASIC' || job.mode === 'ADVANCED') await this.credits.reserveIn(tx, job.id, { account_id: job.account_id, guest_id: job.guest_id });
      await tx.nxGenerationEvent.create({ data: { id: legacyId(), job_id: job.id, event_type: 'job_queued', detail: 'Generation job queued' } });
      return job;
  }
  async queueFailed(id: string) {
    return this.db.$transaction(async tx => {
    const changed = await tx.nxGenerationJob.updateMany({ where: { id, state: 'QUEUED' }, data: {
      state: 'FAILED', error_code: 'QUEUE_UNAVAILABLE', error_message: 'Generation queue is unavailable.', finished_at: new Date(), updated_at: new Date(),
    } });
    if (changed.count) await this.credits.settleIn(tx, id, false);
    });
  }
  claim(id: string, token: string) {
    return this.db.$transaction(async tx => {
      const job = await tx.nxGenerationJob.findUnique({ where: { id } });
      if (!job || !['QUEUED', 'PROCESSING'].includes(job.state) || !await this.leases.acquireIn(tx, 'customer', id, token)) return null;
      if (job.worker_attempts>=this.maxWorkerAttempts) {
        const changed = await tx.nxGenerationJob.updateMany({ where: { id,state: { in: ['QUEUED','PROCESSING'] } },data: {
          state: 'FAILED',error_code: 'WORKER_RETRY_EXHAUSTED',error_message: 'Generation could not finish after worker recovery. Please try again.',
          updated_at: new Date(),finished_at: new Date(),
        } });
        if (changed.count) {
          await this.credits.settleIn(tx,id,false);
          await tx.nxGenerationEvent.create({ data: { id: legacyId(),job_id: id,event_type: 'job_failed',detail: 'WORKER_RETRY_EXHAUSTED' } });
        }
        await this.leases.releaseIn(tx,'customer',id,token);
        return null;
      }
      const changed = await tx.nxGenerationJob.updateMany({ where: { id, state: { in: ['QUEUED', 'PROCESSING'] } }, data: {
        state: 'PROCESSING',worker_attempts: { increment: 1 }, started_at: new Date(), updated_at: new Date(), error_code: null, error_message: null,
      } });
      if (!changed.count) return null;
      await tx.nxGenerationEvent.create({ data: { id: legacyId(), job_id: id, event_type: 'processing_started', detail: 'Worker started processing' } });
      return tx.nxGenerationJob.findUniqueOrThrow({ where: { id } });
    });
  }
  complete(id: string, result: Prisma.NxResultCreateInput, token: string) {
    return this.db.$transaction(async tx => {
      if (!await this.leases.ownedIn(tx, 'customer', id, token)) return false;
      const changed = await tx.nxGenerationJob.updateMany({ where: { id, state: 'PROCESSING' }, data: {
        state: 'COMPLETED', provider: result.provider, model: result.model, updated_at: new Date(), finished_at: new Date(), error_code: null, error_message: null,
      } });
      if (!changed.count) return false;
      await tx.nxResult.create({ data: result });
      await this.credits.settleIn(tx, id, true);
      await tx.nxGenerationEvent.create({ data: { id: legacyId(), job_id: id, event_type: 'result_stored', detail: 'Generation result stored' } });
      await this.leases.releaseIn(tx, 'customer', id, token);
      return true;
    });
  }
  fail(id: string, code: string, message: string, token: string) {
    return this.db.$transaction(async tx => {
      if (!await this.leases.ownedIn(tx, 'customer', id, token)) return false;
      const changed = await tx.nxGenerationJob.updateMany({ where: { id, state: 'PROCESSING' }, data: {
        state: 'FAILED', error_code: code, error_message: message, updated_at: new Date(), finished_at: new Date(),
      } });
      if (!changed.count) return false;
      await this.credits.settleIn(tx, id, false);
      await tx.nxGenerationEvent.create({ data: { id: legacyId(), job_id: id, event_type: 'job_failed', detail: code } });
      await this.leases.releaseIn(tx, 'customer', id, token);
      return true;
    });
  }
}

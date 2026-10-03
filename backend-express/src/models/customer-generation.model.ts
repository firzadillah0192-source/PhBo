import type { PrismaClient, Prisma } from '@prisma/client';
import { CreditAccountingModel } from './credit-accounting.model.js';
import { legacyId } from '../services/customer-credentials.service.js';
import { WorkerLeaseModel } from './worker-lease.model.js';

export class CustomerGenerationModel {
  private readonly credits: CreditAccountingModel;
  readonly leases: WorkerLeaseModel;
  constructor(private readonly db: PrismaClient) { this.credits = new CreditAccountingModel(db); this.leases = new WorkerLeaseModel(db); }
  template(id: string) { return this.db.nxTemplate.findUnique({ where: { id } }); }
  layout(id: string) { return this.db.nxClassicLayout.findUnique({ where: { id } }); }
  experience(id: string) { return this.db.nxExperience.findUnique({ where: { id } }); }
  frame(id: string) { return this.db.nxFrameStyle.findUnique({ where: { id } }); }
  ornaments(ids: string[]) { return this.db.nxOrnament.findMany({ where: { id: { in: ids } } }); }
  find(id: string) { return this.db.nxGenerationJob.findUnique({ where: { id } }); }
  result(job_id: string) { return this.db.nxResult.findFirst({ where: { job_id, deleted_at: null } }); }
  create(data: Prisma.NxGenerationJobCreateInput) {
    return this.db.$transaction(async tx => {
      const job = await tx.nxGenerationJob.create({ data });
      if (job.account_id) await tx.nxAccount.update({ where: { id: job.account_id }, data: { last_activity_at: new Date() } });
      if (job.mode === 'BASIC' || job.mode === 'ADVANCED') await this.credits.reserveIn(tx, job.id, { account_id: job.account_id, guest_id: job.guest_id });
      await tx.nxGenerationEvent.create({ data: { id: legacyId(), job_id: job.id, event_type: 'job_queued', detail: 'Generation job queued' } });
      return job;
    });
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
      const changed = await tx.nxGenerationJob.updateMany({ where: { id, state: { in: ['QUEUED', 'PROCESSING'] } }, data: {
        state: 'PROCESSING', started_at: new Date(), updated_at: new Date(), error_code: null, error_message: null,
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

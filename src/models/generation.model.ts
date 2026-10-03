import type { PrismaClient } from '@prisma/client';
import type { CreateGenerationData, GenerationQuota, JobLease } from '../types/domain.js';
import { randomUUID } from 'node:crypto';
import { ensure } from '../lib/errors.js';

export class GenerationModel {
  constructor(private readonly db: PrismaClient) {}
  find(id: string) { return this.db.generation.findUnique({ where: { id }, include: { session: true } }); }
  list(sessionId: string) { return this.db.generation.findMany({ where: { sessionId }, orderBy: { createdAt: 'desc' } }); }
  findRequest(sessionId: string, requestKey: string) {
    return this.db.generation.findUnique({ where: { sessionId_requestKey: { sessionId, requestKey } } });
  }
  async create(session: GenerationQuota, data: CreateGenerationData) {
    try {
      return await this.db.$transaction(async (tx) => {
        if (data.mode === 'CLASSIC') {
          const active = await tx.photoSession.findFirst({ where: { id: session.id, expiresAt: { gt: new Date() } }, select: { id: true } });
          ensure(active, 410, 'SESSION_EXPIRED', 'Session expired');
          return tx.generation.create({ data: { ...data, sessionId: session.id } });
        }
        const reserved = await tx.photoSession.updateMany({
          where: { id: session.id, expiresAt: { gt: new Date() }, generationUsed: { lt: session.generationLimit } },
          data: { generationUsed: { increment: 1 } },
        });
        ensure(reserved.count === 1, 409, 'GENERATION_LIMIT', 'Session expired or generation quota exhausted');
        return tx.generation.create({ data: { ...data, sessionId: session.id } });
      });
    } catch (error) {
      // A racing retry may encounter either the unique key or exhausted quota.
      const existing = await this.findRequest(session.id, data.requestKey);
      if (existing) return existing;
      throw error;
    }
  }
  async next(leaseSeconds: number) {
    const leaseToken = randomUUID();
    const jobs = await this.db.$queryRaw<Array<{ id: string }>>`
      UPDATE "Generation" SET status = 'PROCESSING', attempts = attempts + 1,
        "leaseToken" = ${leaseToken}::uuid,
        "leaseUntil" = NOW() + ${leaseSeconds} * INTERVAL '1 second', "updatedAt" = NOW()
      WHERE id = (SELECT id FROM "Generation" WHERE status = 'QUEUED'
        ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id`;
    if (!jobs.length) return null;
    const job = await this.db.generation.findUnique({ where: { id: jobs[0].id }, include: { session: { include: { photos: { orderBy: { position: 'asc' } } } }, frame: true } });
    return job ? { ...job, session: { ...job.session, photo: job.session.photos[0] ?? null } } : null;
  }
  async recover(maxAttempts: number) {
    const stale = await this.db.generation.findMany({ where: { status: 'PROCESSING', leaseUntil: { lt: new Date() } } });
    for (const job of stale) {
      if (job.attempts >= maxAttempts) await this.fail(job, 'Worker timeout');
      else await this.db.generation.updateMany({
        where: { id: job.id, status: 'PROCESSING', leaseToken: job.leaseToken, leaseUntil: { lt: new Date() } },
        data: { status: 'QUEUED', leaseToken: null, leaseUntil: null },
      });
    }
  }
  complete(job: JobLease, objectId: string) {
    return this.db.generation.updateMany({
      where: { id: job.id, status: 'PROCESSING', leaseToken: job.leaseToken },
      data: { status: 'COMPLETED', objectId, leaseToken: null, leaseUntil: null },
    });
  }
  fail(job: JobLease, error: string) {
    return this.db.$transaction(async (tx) => {
      const updated = await tx.generation.updateMany({
        where: { id: job.id, status: 'PROCESSING', leaseToken: job.leaseToken },
        data: { status: 'FAILED', error, leaseToken: null, leaseUntil: null },
      });
      if (updated.count && (job.mode === 'BASIC' || job.mode === 'ADVANCED')) {
        await tx.photoSession.update({ where: { id: job.sessionId }, data: { generationUsed: { decrement: 1 } } });
      }
    });
  }
}

import type { PrismaClient } from '@prisma/client';

export type DispatchKind = 'customer' | 'preview';
export class PostgresGenerationQueueModel {
  constructor(private readonly db: PrismaClient) {}
  async enqueue(kind: DispatchKind,id: string) {
    await this.db.$executeRaw`INSERT INTO generation_dispatch(queue_kind,job_id) VALUES (${kind},${id}) ON CONFLICT DO NOTHING`;
  }
  async next(kind: DispatchKind) {
    // Dequeue one dispatch atomically, with no lock held during image/provider
    // work. Existing worker leases prevent concurrent processing of one job.
    const rows = await this.db.$queryRaw<{ job_id: string }[]>`WITH candidate AS (
      SELECT queue_kind,job_id FROM generation_dispatch WHERE queue_kind=${kind}
      ORDER BY enqueued_at,job_id FOR UPDATE SKIP LOCKED LIMIT 1
    ) DELETE FROM generation_dispatch d USING candidate c
      WHERE d.queue_kind=c.queue_kind AND d.job_id=c.job_id RETURNING d.job_id`;
    return rows[0]?.job_id ?? null;
  }
  async ready() { await this.db.$queryRaw`SELECT job_id FROM generation_dispatch LIMIT 0`; return true; }
}

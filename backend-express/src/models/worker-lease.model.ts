import type { PrismaClient, Prisma } from '@prisma/client';
export class WorkerLeaseModel {
  constructor(private readonly db: PrismaClient) {}
  async acquireIn(tx: Prisma.TransactionClient, kind: string, id: string, token: string, seconds = 360) {
    const rows = await tx.$queryRaw<{ job_id: string }[]>`INSERT INTO generation_worker_leases(queue_kind,job_id,owner_token,expires_at)
      VALUES (${kind},${id},${token},now()+${seconds}*interval '1 second')
      ON CONFLICT(queue_kind,job_id) DO UPDATE SET owner_token=EXCLUDED.owner_token,expires_at=EXCLUDED.expires_at,updated_at=now()
      WHERE generation_worker_leases.expires_at<=now() RETURNING job_id`;
    return rows.length === 1;
  }
  async ownedIn(tx: Prisma.TransactionClient, kind: string, id: string, token: string) {
    const rows = await tx.$queryRaw<{ job_id: string }[]>`SELECT job_id FROM generation_worker_leases
      WHERE queue_kind=${kind} AND job_id=${id} AND owner_token=${token} AND expires_at>now() FOR UPDATE`;
    return rows.length === 1;
  }
  async releaseIn(tx: Prisma.TransactionClient, kind: string, id: string, token: string) {
    await tx.nxWorkerLease.deleteMany({ where: { queue_kind: kind, job_id: id, owner_token: token } });
  }
  async renew(kind: string, id: string, token: string, seconds = 360) {
    return (await this.db.$executeRaw`UPDATE generation_worker_leases SET expires_at=now()+${seconds}*interval '1 second',updated_at=now()
      WHERE queue_kind=${kind} AND job_id=${id} AND owner_token=${token} AND expires_at>now()`) === 1;
  }
  async recoverable(kind: 'customer' | 'preview') {
    if (kind === 'customer') return this.db.$queryRaw<{ id: string }[]>`SELECT j.id FROM generation_jobs j LEFT JOIN generation_worker_leases l ON l.queue_kind='customer' AND l.job_id=j.id
      WHERE j.state IN ('QUEUED','PROCESSING') AND (l.job_id IS NULL OR l.expires_at<=now()) ORDER BY j.created_at LIMIT 200`;
    return this.db.$queryRaw<{ id: string }[]>`SELECT j.id FROM preview_generation_jobs j LEFT JOIN generation_worker_leases l ON l.queue_kind='preview' AND l.job_id=j.id
      WHERE j.state IN ('QUEUED','PROCESSING') AND (l.job_id IS NULL OR l.expires_at<=now()) ORDER BY j.created_at LIMIT 200`;
  }
}

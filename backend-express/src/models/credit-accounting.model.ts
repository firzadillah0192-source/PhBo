import type { PrismaClient, Prisma } from '@prisma/client';
import { legacyId } from '../services/customer-credentials.service.js';
import { AppError } from '../lib/errors.js';

export type CreditOwner = { account_id: string | null; guest_id: string | null };
export class CreditAccountingModel {
  constructor(private readonly db: PrismaClient) {}

  // Generation creation must use this inside the SAME transaction as its job.
  async reserveIn(tx: Prisma.TransactionClient, job_id: string, owner: CreditOwner) {
    if (Boolean(owner.account_id) === Boolean(owner.guest_id)) throw new AppError(403, 'AI_QUOTA_EXHAUSTED', 'Your free AI generation quota is exhausted.');
    const existing = await tx.nxQuotaReservation.findUnique({ where: { job_id } });
    if (existing) return existing;
    const now = new Date();
    const changed = owner.account_id
      ? await tx.$executeRaw`UPDATE accounts SET ai_quota_reserved = ai_quota_reserved + 1, updated_at = ${now} WHERE id = ${owner.account_id} AND ai_quota_total > ai_quota_used + ai_quota_reserved`
      : await tx.$executeRaw`UPDATE guest_sessions SET ai_quota_reserved = ai_quota_reserved + 1, updated_at = ${now} WHERE id = ${owner.guest_id} AND ai_quota_total > ai_quota_used + ai_quota_reserved`;
    if (changed !== 1) throw new AppError(403, 'AI_QUOTA_EXHAUSTED', 'Your free AI generation quota is exhausted.');
    const reservation = await tx.nxQuotaReservation.create({ data: { id: legacyId(), job_id, ...owner } });
    await tx.nxCreditLedger.create({ data: { id: legacyId(), user_id: owner.account_id, guest_id: owner.guest_id,
      amount: 0, type: 'generation_reservation', reason: 'AI generation credit reserved',
      idempotency_key: `generation_reservation:${job_id}`, related_generation_id: job_id } });
    await tx.nxGenerationEvent.create({ data: { id: legacyId(), job_id, event_type: 'credit_reserved', detail: 'One AI credit reserved' } });
    return reservation;
  }

  reserve(job_id: string, owner: CreditOwner) { return this.db.$transaction(tx => this.reserveIn(tx, job_id, owner)); }

  async settle(job_id: string, successful: boolean) {
    return this.db.$transaction(tx => this.settleIn(tx, job_id, successful));
  }

  async settleIn(tx: Prisma.TransactionClient, job_id: string, successful: boolean) {
      // Lock the persisted reservation so multiple workers/refund requests cannot
      // consume or refund the same credit twice.
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM quota_reservations WHERE job_id = ${job_id} FOR UPDATE`;
      if (!rows.length) return false;
      const reservation = await tx.nxQuotaReservation.findUnique({ where: { id: rows[0].id } });
      if (!reservation || reservation.status !== 'RESERVED') return false;
      const used = successful ? reservation.amount : 0;
      const now = new Date();
      if (reservation.account_id) await tx.$executeRaw`UPDATE accounts SET ai_quota_reserved = GREATEST(0, ai_quota_reserved - ${reservation.amount}), ai_quota_used = ai_quota_used + ${used}, updated_at = ${now} WHERE id = ${reservation.account_id}`;
      else if (reservation.guest_id) await tx.$executeRaw`UPDATE guest_sessions SET ai_quota_reserved = GREATEST(0, ai_quota_reserved - ${reservation.amount}), ai_quota_used = ai_quota_used + ${used}, updated_at = ${now} WHERE id = ${reservation.guest_id}`;
      await tx.nxQuotaReservation.update({ where: { id: reservation.id }, data: { status: successful ? 'CONSUMED' : 'REFUNDED', settled_at: now } });
      const type = successful ? 'generation_spend' : 'generation_refund';
      await tx.nxCreditLedger.create({ data: { id: legacyId(), user_id: reservation.account_id, guest_id: reservation.guest_id,
        amount: successful ? -reservation.amount : 0, type,
        reason: successful ? 'AI generation completed' : 'AI generation failed; reservation returned',
        idempotency_key: `${type}:${job_id}`, related_generation_id: job_id } });
      await tx.nxGenerationEvent.create({ data: { id: legacyId(), job_id,
        event_type: successful ? 'credit_finalized' : 'credit_refunded',
        detail: successful ? 'Credit consumed' : 'Credit reservation refunded' } });
      return true;
  }
}

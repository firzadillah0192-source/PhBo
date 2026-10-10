import type { PrismaClient, Prisma } from '@prisma/client';
import { legacyId } from '../services/customer-credentials.service.js';
import { CreditWalletModel } from './credit-wallet.model.js';
import { priceCompletedGeneration, readGenerationCharge } from '../services/generation-credit-charge.service.js';
import { AppError } from '../lib/errors.js';

export type CreditOwner = { account_id: string | null; guest_id: string | null };
export class CreditAccountingModel {
  constructor(private readonly db: PrismaClient) {}

  // Preserve the existing kiosk generation allowance independently of customer wallets.
  async reserveKioskIn(tx: Prisma.TransactionClient, job_id: string, owner: CreditOwner) {
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

  // Generation creation must use this inside the SAME transaction as its job.
  async reserveIn(tx: Prisma.TransactionClient, job_id: string, owner: CreditOwner) {
    if (Boolean(owner.account_id) === Boolean(owner.guest_id)) throw new AppError(403, 'AI_QUOTA_EXHAUSTED', 'Your free AI generation quota is exhausted.');
    const existing = await tx.nxQuotaReservation.findUnique({ where: { job_id } });
    if (existing) return existing;
    const job = await tx.nxGenerationJob.findUniqueOrThrow({ where: { id: job_id } });
    const minimum = job.mode === 'CLASSIC' ? 1 : 10;
    if (owner.account_id) await new CreditWalletModel(this.db).ensureIn(tx, owner.account_id);
    else await tx.$queryRaw`SELECT id FROM guest_sessions WHERE id=${owner.guest_id} FOR UPDATE`;
    const account = owner.account_id ? await tx.nxAccount.findUnique({ where: { id: owner.account_id } }) : await tx.nxGuestSession.findUnique({ where: { id: owner.guest_id! } });
    const remaining = account ? account.ai_quota_total - account.ai_quota_used - account.ai_quota_reserved : 0;
    if (remaining < minimum) throw new AppError(403, 'AI_QUOTA_EXHAUSTED', `Kredit tidak mencukupi. Minimal ${minimum} kredit untuk ${job.mode === 'CLASSIC' ? 'Photo Booth' : 'generate AI'}.`);
    const active = await tx.nxGenerationJob.count({ where: { id: { not: job_id }, ...(owner.account_id ? { account_id: owner.account_id } : { guest_id: owner.guest_id }), state: { in: ['QUEUED','PROCESSING'] } } });
    if (active) throw new AppError(409, 'GENERATION_IN_PROGRESS', 'Tunggu generate sebelumnya selesai sebelum membuat gambar baru.');
    if (owner.account_id && job.mode !== 'CLASSIC') {
      const [pending] = await tx.$queryRaw<{ status: string }[]>`SELECT c.status FROM generation_credit_charges c JOIN generation_jobs j ON j.id=c.job_id WHERE j.account_id=${owner.account_id} AND c.status IN ('PENDING_USAGE','NEEDS_TOP_UP') ORDER BY c.created_at LIMIT 1`;
      if (pending?.status === 'PENDING_USAGE') throw new AppError(409, 'CREDIT_USAGE_UNAVAILABLE', 'Hasil sebelumnya masih menunggu rincian pemakaian. Kredit belum dipotong.');
      if (pending) throw new AppError(402, 'GENERATION_PAYMENT_PENDING', 'Selesaikan perhitungan atau isi kredit untuk hasil sebelumnya terlebih dahulu.');
    }
    const reservation = await tx.nxQuotaReservation.create({ data: { id: legacyId(), job_id, ...owner, amount: 0 } });
    await tx.$executeRaw`INSERT INTO generation_credit_charges(job_id,status) VALUES(${job_id},'PENDING_RESULT')`;
    await tx.nxCreditLedger.create({ data: { id: legacyId(), user_id: owner.account_id, guest_id: owner.guest_id, amount: 0, type: 'generation_reservation', reason: 'Generation started; credits are calculated and charged only after success', idempotency_key: `generation_reservation:${job_id}`, related_generation_id: job_id } });
    await tx.nxGenerationEvent.create({ data: { id: legacyId(), job_id, event_type: 'credit_pending', detail: 'No credits deducted before the result is ready' } });
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
      const charge = await readGenerationCharge(tx, job_id);
      if (charge && successful) {
        const job = await tx.nxGenerationJob.findUniqueOrThrow({ where: { id: job_id } });
        const price = await priceCompletedGeneration(tx, job_id, job.mode);
        if (!price) {
          await tx.$executeRaw`UPDATE generation_credit_charges SET status='PENDING_USAGE' WHERE job_id=${job_id}`;
          return false;
        }
        await tx.$executeRaw`UPDATE generation_credit_charges SET credits=${price.credits},calculation_json=${JSON.stringify(price.calculation)} WHERE job_id=${job_id}`;
        if (reservation.account_id) await new CreditWalletModel(this.db).ensureIn(tx, reservation.account_id);
        else await tx.$queryRaw`SELECT id FROM guest_sessions WHERE id=${reservation.guest_id} FOR UPDATE`;
        const owner = reservation.account_id ? await tx.nxAccount.findUniqueOrThrow({ where: { id: reservation.account_id } }) : await tx.nxGuestSession.findUniqueOrThrow({ where: { id: reservation.guest_id! } });
        if (owner.ai_quota_total - owner.ai_quota_used - owner.ai_quota_reserved < price.credits) {
          await tx.$executeRaw`UPDATE generation_credit_charges SET status='NEEDS_TOP_UP' WHERE job_id=${job_id}`;
          return false;
        }
        if (reservation.account_id && price.credits > 0) {
          // The initial reservation has no amount and takes no balance. Allocate
          // only now, then consume within the same locked completion transaction.
          await tx.nxQuotaReservation.delete({ where: { id: reservation.id } });
          await new CreditWalletModel(this.db).allocateIn(tx, job_id, reservation.account_id, price.credits);
          const priced = await tx.nxQuotaReservation.findUniqueOrThrow({ where: { job_id } });
          reservation.id = priced.id; reservation.amount = priced.amount;
        } else if (reservation.guest_id) {
          await tx.nxQuotaReservation.update({ where: { id: reservation.id }, data: { amount: price.credits } });
          await tx.nxGuestSession.update({ where: { id: reservation.guest_id! }, data: { ai_quota_reserved: { increment: price.credits } } });
          reservation.amount = price.credits;
        }
      }
      const walletSettled = reservation.account_id ? await new CreditWalletModel(this.db).settleIn(tx, job_id, successful, reservation.amount) : false;
      const used = successful ? reservation.amount : 0;
      const now = new Date();
      if (reservation.account_id && !walletSettled) await tx.$executeRaw`UPDATE accounts SET ai_quota_reserved = GREATEST(0, ai_quota_reserved - ${reservation.amount}), ai_quota_used = ai_quota_used + ${used}, updated_at = ${now} WHERE id = ${reservation.account_id}`;
      else if (reservation.guest_id) await tx.$executeRaw`UPDATE guest_sessions SET ai_quota_reserved = GREATEST(0, ai_quota_reserved - ${reservation.amount}), ai_quota_used = ai_quota_used + ${used}, updated_at = ${now} WHERE id = ${reservation.guest_id}`;
      await tx.nxQuotaReservation.update({ where: { id: reservation.id }, data: { status: successful ? 'CONSUMED' : 'REFUNDED', settled_at: now } });
      if (charge) await tx.$executeRaw`UPDATE generation_credit_charges SET status=${successful ? 'PAID' : 'REFUNDED'},settled_at=${now} WHERE job_id=${job_id}`;
      const type = successful ? 'generation_spend' : 'generation_refund';
      await tx.nxCreditLedger.create({ data: { id: legacyId(), user_id: reservation.account_id, guest_id: reservation.guest_id,
        amount: successful ? -reservation.amount : 0, type,
        reason: successful ? 'Successful result charged after calculation' : 'Generation failed; no credits charged',
        idempotency_key: `${type}:${job_id}`, related_generation_id: job_id } });
      await tx.nxGenerationEvent.create({ data: { id: legacyId(), job_id,
        event_type: successful ? 'credit_finalized' : 'credit_refunded',
        detail: successful ? 'Credit consumed' : 'Credit reservation refunded' } });
      return true;
  }
}

import type { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../lib/errors.js';
import { legacyId } from '../services/customer-credentials.service.js';

export const FREE_CREDITS = 50;
export const FREE_PERIOD_MS = 14 * 86400000;
type Wallet = { account_id: string; free_remaining: number; top_up_remaining: number; cycle_started_at: Date };
export type WalletAllocation = { account_id: string; free_amount: number; top_up_amount: number; cycle_started_at: Date };
export class CreditWalletModel {
  constructor(private readonly db: PrismaClient, private readonly clock: () => Date = () => new Date()) {}
  async ensureIn(tx: Prisma.TransactionClient, id: string): Promise<Wallet> {
    const now = this.clock();
    const accounts = await tx.$queryRaw<{ ai_quota_total: number; ai_quota_used: number; ai_quota_reserved: number }[]>`SELECT ai_quota_total,ai_quota_used,ai_quota_reserved FROM accounts WHERE id=${id} FOR UPDATE`;
    const account = accounts[0];
    if (!account) throw new AppError(404, 'USER_NOT_FOUND', 'Account unavailable.');
    let [wallet] = await tx.$queryRaw<Wallet[]>`SELECT * FROM credit_wallets WHERE account_id=${id} FOR UPDATE`;
    const legacyRemaining = Math.max(0, account.ai_quota_total - account.ai_quota_used - account.ai_quota_reserved);
    if (!wallet) {
      [wallet] = await tx.$queryRaw<Wallet[]>`INSERT INTO credit_wallets(account_id,free_remaining,top_up_remaining,cycle_started_at,updated_at) VALUES(${id},${FREE_CREDITS},${legacyRemaining},${now},${now}) RETURNING *`;
      await tx.nxCreditLedger.create({ data: { id: legacyId(), user_id: id, amount: FREE_CREDITS, type: 'free_credit_reset', reason: 'Initial 50 free credits; existing balance preserved separately', idempotency_key: `free_credit_reset:${id}:${now.toISOString()}`, metadata_json: JSON.stringify({ free_remaining: FREE_CREDITS, legacy_carried_credits: legacyRemaining }) } });
    } else {
      // Existing admin grants and legacy in-flight refunds still write the compatibility
      // counters. Reconcile their change while the account is locked, never lose it.
      const delta = legacyRemaining - wallet.free_remaining - wallet.top_up_remaining;
      if (delta > 0) wallet.top_up_remaining += delta;
      if (delta < 0) {
        const paidDeduction = Math.min(wallet.top_up_remaining, -delta);
        wallet.top_up_remaining -= paidDeduction;
        wallet.free_remaining = Math.max(0, wallet.free_remaining + delta + paidDeduction);
      }
      const periods = Math.floor((now.getTime() - wallet.cycle_started_at.getTime()) / FREE_PERIOD_MS);
      if (periods > 0) {
        const expired = wallet.free_remaining;
        wallet.cycle_started_at = new Date(wallet.cycle_started_at.getTime() + periods * FREE_PERIOD_MS);
        wallet.free_remaining = FREE_CREDITS;
        await tx.nxCreditLedger.create({ data: { id: legacyId(), user_id: id, amount: FREE_CREDITS - expired, type: 'free_credit_reset', reason: 'Free balance reset to 50 for the current 14-day period', idempotency_key: `free_credit_reset:${id}:${wallet.cycle_started_at.toISOString()}`, metadata_json: JSON.stringify({ expired_free_credits: expired, free_remaining: FREE_CREDITS }) } });
      }
      await tx.$executeRaw`UPDATE credit_wallets SET free_remaining=${wallet.free_remaining},top_up_remaining=${wallet.top_up_remaining},cycle_started_at=${wallet.cycle_started_at},updated_at=${now} WHERE account_id=${id}`;
    }
    await this.syncIn(tx, id, wallet);
    return wallet;
  }
  private async syncIn(tx: Prisma.TransactionClient, id: string, wallet: Wallet) {
    await tx.$executeRaw`UPDATE accounts SET ai_quota_total=ai_quota_used+ai_quota_reserved+${wallet.free_remaining + wallet.top_up_remaining},updated_at=${this.clock()} WHERE id=${id}`;
  }
  async snapshot(id: string) {
    return this.db.$transaction(async tx => {
      const wallet = await this.ensureIn(tx, id);
      const account = await tx.nxAccount.findUniqueOrThrow({ where: { id } });
      const usage = { ai_total: account.ai_quota_total, ai_used: account.ai_quota_used, ai_reserved: account.ai_quota_reserved, ai_remaining: wallet.free_remaining + wallet.top_up_remaining };
      return { usage, free_remaining: wallet.free_remaining, top_up_remaining: wallet.top_up_remaining, free_allocation: FREE_CREDITS, reset_every_days: 14, next_reset_at: new Date(wallet.cycle_started_at.getTime() + FREE_PERIOD_MS), spend_order: 'free_first' };
    });
  }
  async allocateIn(tx: Prisma.TransactionClient, jobId: string, id: string, amount: number) {
    if (!Number.isSafeInteger(amount) || amount < 1) throw new AppError(422, 'CREDIT_PRICE_UNAVAILABLE', 'Credit price unavailable.');
    const wallet = await this.ensureIn(tx, id);
    if (wallet.free_remaining + wallet.top_up_remaining < amount) throw new AppError(403, 'AI_QUOTA_EXHAUSTED', 'Not enough credits. Add creative supplies to continue.');
    const free = Math.min(wallet.free_remaining, amount), topUp = amount - free;
    wallet.free_remaining -= free; wallet.top_up_remaining -= topUp;
    await tx.$executeRaw`UPDATE credit_wallets SET free_remaining=${wallet.free_remaining},top_up_remaining=${wallet.top_up_remaining},updated_at=${this.clock()} WHERE account_id=${id}`;
    await tx.$executeRaw`UPDATE accounts SET ai_quota_reserved=ai_quota_reserved+${amount} WHERE id=${id}`;
    await tx.nxQuotaReservation.create({ data: { id: legacyId(), job_id: jobId, account_id: id, guest_id: null, amount } });
    await tx.$executeRaw`INSERT INTO credit_wallet_reservations(job_id,account_id,free_amount,top_up_amount,cycle_started_at) VALUES(${jobId},${id},${free},${topUp},${wallet.cycle_started_at})`;
    await this.syncIn(tx, id, wallet);
  }
  async settleIn(tx: Prisma.TransactionClient, jobId: string, successful: boolean, amount: number) {
    const [allocation] = await tx.$queryRaw<WalletAllocation[]>`SELECT * FROM credit_wallet_reservations WHERE job_id=${jobId}`;
    if (!allocation) return false; // Legacy reservation uses legacy settlement.
    const wallet = await this.ensureIn(tx, allocation.account_id);
    if (!successful) {
      // Refund expired free credits only to their original period, never inflate
      // the new allocation. Paid credits always return, including across resets.
      if (wallet.cycle_started_at.getTime() === allocation.cycle_started_at.getTime()) wallet.free_remaining += allocation.free_amount;
      wallet.top_up_remaining += allocation.top_up_amount;
    }
    await tx.$executeRaw`UPDATE credit_wallets SET free_remaining=${wallet.free_remaining},top_up_remaining=${wallet.top_up_remaining},updated_at=${this.clock()} WHERE account_id=${allocation.account_id}`;
    await tx.$executeRaw`UPDATE accounts SET ai_quota_reserved=GREATEST(0,ai_quota_reserved-${amount}),ai_quota_used=ai_quota_used+${successful ? amount : 0} WHERE id=${allocation.account_id}`;
    await this.syncIn(tx, allocation.account_id, wallet);
    return true;
  }
}

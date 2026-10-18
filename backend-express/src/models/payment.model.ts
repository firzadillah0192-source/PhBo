import type { PrismaClient } from '@prisma/client';
import { AppError } from '../lib/errors.js';
import { legacyId } from '../services/customer-credentials.service.js';

export type PaymentStatus = 'CREATING' | 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED';
export type PaymentProduct = { kind: 'ai_topup' | 'subscription'; code: string; amount_rupiah: number; policy_version: 2 };
export type Payment = {
  id: string; account_id: string; request_key: string; merchant_order_id: string; environment: 'sandbox';
  credits: number; amount_rupiah: number; status: PaymentStatus; reference: string | null; checkout_url: string | null;
  error_code: string | null; last_checked_at: Date | null; callback_received_at: Date | null;
  sandbox_credited_at: Date | null; expires_at: Date; paid_at: Date | null; created_at: Date; updated_at: Date;
  product_kind?: string | null; product_code?: string | null; policy_version?: number | null;
};
export type PaymentFilter = { page: number; page_size: number; status?: PaymentStatus; search?: string; account_id?: string };
export interface PaymentStore {
  create(account: string, key: string, credits: number, expiry: Date, product?: PaymentProduct): Promise<Payment>;
  find(id: string): Promise<Payment | null>;
  byOrder(order: string): Promise<Payment | null>;
  claimInvoice(id: string): Promise<boolean>;
  invoice(id: string, reference: string, url: string): Promise<void>;
  invoiceError(id: string): Promise<void>;
  claimVerification(id: string): Promise<boolean>;
  verificationError(id: string, notStarted?: boolean): Promise<void>;
  settle(id: string, reference: string, status: 'PAID' | 'PENDING' | 'FAILED', callback: boolean): Promise<Payment>;
  list(filter: PaymentFilter): Promise<{ transactions: (Payment & { user_email?: string })[]; total: number }>;
  sandboxBalance(account: string): Promise<number>;
  auditCheck(id: string, actor: string): Promise<void>;
}
export class PaymentModel implements PaymentStore {
  constructor(private readonly db: PrismaClient) {}
  async auditCheck(id: string, actor: string) {
    await this.db.nxAuditLog.create({ data: { id: legacyId(), admin_actor_id: actor, action: 'payment.sandbox.check', target_type: 'payment_transaction', target_id: id, reason: 'Request authenticated Duitku Sandbox status verification' } });
  }
  async create(account: string, key: string, credits: number, expiry: Date, product?: PaymentProduct) {
    const id = legacyId(), order = `nxpay_${id}`;
    if (product) {
      const [row] = await this.db.$queryRaw<Payment[]>`INSERT INTO payment_transactions(id,account_id,request_key,merchant_order_id,credits,amount_rupiah,expires_at,product_kind,product_code,policy_version)
        VALUES(${id},${account},${key},${order},${credits},${product.amount_rupiah},${expiry},${product.kind},${product.code},${product.policy_version})
        ON CONFLICT(account_id,request_key) DO UPDATE SET request_key=payment_transactions.request_key RETURNING *`;
      if (row.credits !== credits || row.amount_rupiah !== product.amount_rupiah || row.product_kind !== product.kind || row.product_code !== product.code || row.policy_version !== 2) throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Produk berbeda. Mulai pesanan baru.');
      return row;
    }
    const [row] = await this.db.$queryRaw<Payment[]>`INSERT INTO payment_transactions(id,account_id,request_key,merchant_order_id,credits,amount_rupiah,expires_at)
      VALUES(${id},${account},${key},${order},${credits},${credits * 100},${expiry})
      ON CONFLICT(account_id,request_key) DO UPDATE SET request_key=payment_transactions.request_key RETURNING *`;
    if (row.credits !== credits || row.policy_version === 2) throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Jumlah kredit berbeda. Mulai pesanan baru.');
    return row;
  }
  async find(id: string) { const [row] = await this.db.$queryRaw<Payment[]>`SELECT * FROM payment_transactions WHERE id=${id}`; return row ?? null; }
  async byOrder(order: string) { const [row] = await this.db.$queryRaw<Payment[]>`SELECT * FROM payment_transactions WHERE merchant_order_id=${order}`; return row ?? null; }
  async claimInvoice(id: string) {
    return Boolean(await this.db.$executeRaw`UPDATE payment_transactions SET invoice_lease_until=now()+interval '30 seconds' WHERE id=${id} AND status IN ('CREATING','PENDING') AND checkout_url IS NULL AND expires_at>now() AND (invoice_lease_until IS NULL OR invoice_lease_until<now())`);
  }
  async invoice(id: string, reference: string, url: string) {
    await this.db.$executeRaw`UPDATE payment_transactions SET reference=${reference},checkout_url=${url},status=CASE WHEN status='CREATING' THEN 'PENDING' ELSE status END,error_code=NULL,invoice_lease_until=NULL,updated_at=now() WHERE id=${id} AND (reference IS NULL OR reference=${reference})`;
  }
  async invoiceError(id: string) { await this.db.$executeRaw`UPDATE payment_transactions SET error_code='INVOICE_UNCONFIRMED',invoice_lease_until=NULL,updated_at=now() WHERE id=${id} AND status='CREATING'`; }
  async claimVerification(id: string) {
    return Boolean(await this.db.$executeRaw`UPDATE payment_transactions SET verification_lease_until=now()+interval '30 seconds' WHERE id=${id} AND status<>'PAID' AND (verification_lease_until IS NULL OR verification_lease_until<now()) AND (last_checked_at IS NULL OR last_checked_at<now()-interval '30 seconds')`);
  }
  async verificationError(id: string, notStarted = false) { const code = notStarted ? 'PAYMENT_METHOD_NOT_SELECTED' : 'VERIFICATION_UNAVAILABLE'; await this.db.$executeRaw`UPDATE payment_transactions SET error_code=${code},verification_lease_until=NULL,last_checked_at=now(),updated_at=now() WHERE id=${id} AND status<>'PAID'`; }
  async settle(id: string, reference: string, status: 'PAID' | 'PENDING' | 'FAILED', callback: boolean) {
    // One atomic transition is the sandbox credit ledger. Its PAID rows are summed
    // for the sandbox balance; no write touches the spendable production wallet.
    const rows = await this.db.$queryRaw<Payment[]>`UPDATE payment_transactions SET
      reference=COALESCE(reference,${reference}),
      status=CASE WHEN status='PAID' THEN 'PAID' WHEN ${status}='PENDING' AND expires_at<=now() THEN 'EXPIRED' ELSE ${status} END,
      paid_at=CASE WHEN ${status}='PAID' THEN COALESCE(paid_at,now()) ELSE paid_at END,
      sandbox_credited_at=CASE WHEN ${status}='PAID' THEN COALESCE(sandbox_credited_at,now()) ELSE sandbox_credited_at END,
      callback_received_at=CASE WHEN ${callback} THEN now() ELSE callback_received_at END,
      verification_lease_until=NULL,last_checked_at=now(),error_code=NULL,updated_at=now()
      WHERE id=${id} AND (reference IS NULL OR reference=${reference}) RETURNING *`;
    if (!rows[0]) throw new AppError(409, 'PAYMENT_REFERENCE_MISMATCH', 'Referensi pembayaran tidak cocok.');
    return rows[0];
  }
  async list(f: PaymentFilter) {
    const search = f.search ? `%${f.search}%` : null, status = f.status ?? null, account = f.account_id ?? null;
    const where = this.db.$queryRaw<(Payment & { user_email: string })[]>`SELECT p.*,a.email AS user_email FROM payment_transactions p JOIN accounts a ON a.id=p.account_id
      WHERE (${account}::text IS NULL OR p.account_id=${account}) AND (${status}::text IS NULL OR p.status=${status})
      AND (${search}::text IS NULL OR p.merchant_order_id ILIKE ${search} OR p.reference ILIKE ${search} OR a.email ILIKE ${search})
      ORDER BY p.created_at DESC,p.id DESC LIMIT ${f.page_size} OFFSET ${(f.page - 1) * f.page_size}`;
    const counts = this.db.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total FROM payment_transactions p JOIN accounts a ON a.id=p.account_id
      WHERE (${account}::text IS NULL OR p.account_id=${account}) AND (${status}::text IS NULL OR p.status=${status})
      AND (${search}::text IS NULL OR p.merchant_order_id ILIKE ${search} OR p.reference ILIKE ${search} OR a.email ILIKE ${search})`;
    const [transactions, [count]] = await Promise.all([where, counts]);
    return { transactions, total: count.total };
  }
  async sandboxBalance(account: string) {
    const [row] = await this.db.$queryRaw<{ credits: number }[]>`SELECT COALESCE(sum(credits),0)::float8 AS credits FROM payment_transactions WHERE account_id=${account} AND status='PAID'`;
    return row.credits;
  }
}

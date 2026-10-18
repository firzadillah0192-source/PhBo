import { z } from 'zod';
import type { Payment, PaymentStore, PaymentProduct } from '../models/payment.model.js';
import { subscriptionPlan, aiTopUpRupiah } from './subscription-policy.service.js';
import { AppError } from '../lib/errors.js';
import { referenceSchema, sandboxCheckoutUrl, type SandboxGateway } from './duitku-sandbox.service.js';

export const checkoutInput = z.object({ credits: z.number().int().min(1).max(100000) }).strict();
export const paymentKey = z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/);
export const paymentId = z.string().regex(/^[a-f0-9]{32}$/);
const callbackInput = z.object({ merchantCode: z.string().min(1).max(64), amount: z.string().regex(/^\d+(?:\.0{1,2})?$/).max(20),
  merchantOrderId: z.string().regex(/^nxpay_[a-f0-9]{32}$/), reference: referenceSchema, signature: z.string().min(1).max(128), resultCode: z.enum(['00','01']) });
export const paymentFilter = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), page_size: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(['CREATING','PENDING','PAID','FAILED','EXPIRED']).optional(), search: z.string().trim().max(128).optional() });
export function publicPayment(row: Payment) {
  return { id: row.id, merchant_order_id: row.merchant_order_id, environment: row.environment, credits: row.credits, amount_rupiah: row.amount_rupiah,
    status: row.status, reference: row.reference, error_code: row.error_code, last_checked_at: row.last_checked_at, callback_received_at: row.callback_received_at,
    sandbox_credited_at: row.sandbox_credited_at, expires_at: row.expires_at, paid_at: row.paid_at, created_at: row.created_at, updated_at: row.updated_at,
    product_kind: row.product_kind ?? 'ai_topup', product_code: row.product_code ?? null, policy_version: row.policy_version ?? 1 };
}
export class PaymentService {
  constructor(readonly store: PaymentStore, private readonly gateway: SandboxGateway, private readonly config: { enabled: boolean; publicOrigin: string; creditRupiah?: number }) {}
  available() { return this.config.enabled && this.gateway.available() && /^https:\/\//.test(this.config.publicOrigin); }
  settings() { return { enabled: this.available(), environment: 'sandbox', credit_rupiah: this.config.creditRupiah ?? 100, max_credits: 100000,
    message: 'Sandbox: pembayaran simulasi. Saldo uji terpisah dan tidak dapat dipakai untuk membuat foto.' }; }
  private ready() { if (!this.available()) throw new AppError(503, 'PAYMENT_GATEWAY_UNAVAILABLE', 'Pembayaran belum tersedia. Hubungi support@gennexbyte.com.'); }
  private async owned(id: string, account?: string) {
    const row = await this.store.find(paymentId.parse(id));
    if (!row || account && row.account_id !== account) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Pesanan pembayaran tidak ditemukan.');
    return row;
  }
  async checkoutV2(account: { id: string; email: string }, input: { plan_code: string } | { credits: number }, key: string) {
    if ('plan_code' in input) {
      const plan = subscriptionPlan(input.plan_code);
      if (!plan.premium) throw new AppError(422, 'PLAN_NOT_PURCHASABLE', 'Paket Free tidak memerlukan checkout.');
      return this.checkout(account, plan.monthly_ai_credits, key, { kind: 'subscription', code: plan.code, amount_rupiah: plan.price_rupiah, policy_version: 2 });
    }
    return this.checkout(account, checkoutInput.parse(input).credits, key, { kind: 'ai_topup', code: 'ai', amount_rupiah: aiTopUpRupiah(input.credits), policy_version: 2 });
  }
  async checkout(account: { id: string; email: string }, credits: number, key: string, product?: PaymentProduct) {
    this.ready();
    const row = await this.store.create(account.id, paymentKey.parse(key), checkoutInput.parse({ credits }).credits, new Date(Date.now() + 3600000), product);
    if (row.status === 'PENDING' && row.checkout_url && row.expires_at > new Date()) return { ...publicPayment(row), checkout_url: sandboxCheckoutUrl(row.checkout_url) };
    if (!['CREATING','PENDING'].includes(row.status) || row.expires_at <= new Date()) throw new AppError(409, 'PAYMENT_ORDER_CLOSED', 'Pesanan ini sudah diproses atau kedaluwarsa. Mulai pesanan baru.');
    if (!await this.store.claimInvoice(row.id)) throw new AppError(409, 'PAYMENT_IN_PROGRESS', 'Checkout pesanan ini sedang disiapkan. Coba kembali.');
    try {
      const invoice = await this.gateway.invoice({ order: row.merchant_order_id, credits: row.credits, amount: row.amount_rupiah, email: account.email, ...(row.product_kind === 'subscription' ? { productName: `NXBooth Sandbox - Paket ${row.product_code}` } : {}),
        callbackUrl: this.config.publicOrigin + '/api/payments/duitku/callback', returnUrl: this.config.publicOrigin + '/payment-return.html?order_id=' + row.id });
      await this.store.invoice(row.id, invoice.reference, invoice.checkout_url);
      const saved = await this.owned(row.id, account.id);
      if (saved.status !== 'PENDING') return { ...publicPayment(saved), checkout_url: null };
      return { ...publicPayment(saved), checkout_url: sandboxCheckoutUrl(invoice.checkout_url) };
    } catch (error) { await this.store.invoiceError(row.id); throw error; }
  }
  async list(query: unknown, account?: string) {
    this.ready(); const filter = paymentFilter.parse(query);
    const result = await this.store.list({ ...filter, account_id: account });
    return { ...this.settings(), ...filter, total: result.total, sandbox_balance: account && this.config.creditRupiah !== 10 ? await this.store.sandboxBalance(account) : null,
      transactions: result.transactions.map(row => ({ ...publicPayment(row), ...!account ? { account_id: row.account_id, user_email: row.user_email } : {} })) };
  }
  async detail(id: string, account?: string) { this.ready(); return publicPayment(await this.owned(id, account)); }
  async adminRefresh(id: string, actor: string) {
    this.ready(); await this.owned(id); await this.store.auditCheck(id, actor);
    return this.refresh(id);
  }
  async refresh(id: string, account?: string, callback = false, expectedReference?: string) {
    this.ready(); const row = await this.owned(id, account);
    if (expectedReference && row.reference && expectedReference !== row.reference) throw new AppError(409, 'PAYMENT_REFERENCE_MISMATCH', 'Referensi pembayaran tidak cocok.');
    if (row.status === 'PAID') return publicPayment(row);
    if (!await this.store.claimVerification(id)) throw new AppError(429, 'PAYMENT_CHECK_RATE_LIMITED', 'Tunggu 30 detik sebelum cek ulang pembayaran.');
    try {
      const result = await this.gateway.status(row.merchant_order_id);
      if ('notStarted' in result) {
        await this.store.verificationError(row.id, true);
        return publicPayment(await this.owned(row.id));
      }
      if (result.merchantOrderId !== row.merchant_order_id || result.amount !== row.amount_rupiah || row.reference && result.reference !== row.reference || expectedReference && result.reference !== expectedReference) {
        throw new AppError(409, 'PAYMENT_VERIFICATION_MISMATCH', 'Detail pembayaran tidak cocok dengan pesanan.');
      }
      return publicPayment(await this.store.settle(row.id, result.reference, result.statusCode === '00' ? 'PAID' : result.statusCode === '02' ? 'FAILED' : 'PENDING', callback));
    } catch (error) { await this.store.verificationError(id); throw error; }
  }
  async callback(body: unknown) {
    this.ready(); const input = callbackInput.parse(body);
    if (!this.gateway.verifyCallback(input)) throw new AppError(403, 'PAYMENT_SIGNATURE_INVALID', 'Signature pembayaran tidak valid.');
    const row = await this.store.byOrder(input.merchantOrderId);
    if (!row) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Pesanan pembayaran tidak ditemukan.');
    if (Number(input.amount) !== row.amount_rupiah) throw new AppError(409, 'PAYMENT_AMOUNT_MISMATCH', 'Nominal pembayaran tidak cocok.');
    // resultCode is not part of Duitku's callback HMAC. Always verify it via
    // authenticated server-to-server status before any terminal transition.
    await this.refresh(row.id, undefined, true, input.reference);
  }
}

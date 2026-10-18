import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';

export const DUITKU_INVOICE_URL = 'https://api-sandbox.duitku.com/api/merchant/createInvoice';
export const DUITKU_STATUS_URL = 'https://api-sandbox.duitku.com/api/merchant/transactionStatus';
// The provider advertises multiple addresses. Retry DNS answers on transport
// failure only, retaining the original hostname/SNI and normal TLS validation.
// Never retry an HTTP failure, and never follow a redirect with credentials.
export const duitkuHttpsFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  if (![DUITKU_INVOICE_URL, DUITKU_STATUS_URL].includes(url.href)) throw new Error('Unexpected payment endpoint');
  const addresses = await lookup(url.hostname, { all: true });
  for (let index = 0; index < Math.min(addresses.length, 2); index++) {
    const address = addresses[index];
    try {
      return await new Promise<Response>((resolve, reject) => {
        const req = httpsRequest(url, { method: 'POST', signal: init?.signal ?? undefined,
          family: address.family,
          lookup: (_host, _options, callback) => callback(null, address.address, address.family),
          headers: Object.fromEntries(new Headers(init?.headers).entries()),
        }, res => {
          const chunks: Buffer[] = []; let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > 65536) { req.destroy(new Error('Payment response too large')); return; }
            chunks.push(chunk);
          });
          res.on('error', reject);
          res.on('end', () => {
            const headers = new Headers();
            for (const [key, value] of Object.entries(res.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
            resolve(new Response(res.statusCode === 204 ? null : Buffer.concat(chunks), { status: res.statusCode ?? 502, headers }));
          });
        });
        const timer = setTimeout(() => req.destroy(new Error('Payment address timeout')), 5000).unref();
        req.on('close', () => clearTimeout(timer));
        req.on('error', reject);
        req.end(typeof init?.body === 'string' ? init.body : undefined);
      });
    } catch (error) { if (init?.signal?.aborted || index + 1 >= Math.min(addresses.length, 2)) throw error; }
  }
  throw new Error('Payment hostname unavailable');
};
export const referenceSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
export function sandboxCheckoutUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname === 'app-sandbox.duitku.com' && !url.username && !url.password && !url.port && url.pathname === '/redirect_checkout') return url.href;
  } catch {}
  throw new AppError(502, 'PAYMENT_GATEWAY_INVALID_RESPONSE', 'Respons pembayaran tidak valid.');
}
export type InvoiceInput = { order: string; amount: number; credits: number; email: string; callbackUrl: string; returnUrl: string; productName?: string };
export type VerifiedStatus = { merchantOrderId: string; reference: string; amount: number; statusCode: '00' | '01' | '02' };
export type NotStartedStatus = { notStarted: true };
export interface SandboxGateway {
  available(): boolean;
  invoice(input: InvoiceInput): Promise<{ reference: string; checkout_url: string }>;
  status(order: string): Promise<VerifiedStatus | NotStartedStatus>;
  verifyCallback(input: { merchantCode: string; amount: string; merchantOrderId: string; signature: string }): boolean;
}
export class DuitkuSandboxGateway implements SandboxGateway {
  constructor(private readonly config: { merchantCode: string; apiKey: string }, private readonly transport: typeof fetch = duitkuHttpsFetch) {}
  available() { return Boolean(this.config.merchantCode.trim() && this.config.apiKey.trim()); }
  private sign(value: string) { return createHmac('sha256', this.config.apiKey).update(value).digest('hex'); }
  private async post(url: string, body: object, headers: Record<string, string> = {}): Promise<unknown> {
    if (!this.available()) throw new AppError(503, 'PAYMENT_GATEWAY_UNAVAILABLE', 'Pembayaran belum tersedia. Hubungi support@gennexbyte.com.');
    try {
      const response = await this.transport(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12000),
        headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
      if (!response.body) throw new Error();
      const chunks: Uint8Array[] = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 65536) throw new Error();
        chunks.push(chunk);
      }
      const text = Buffer.concat(chunks).toString('utf8');
      let data: unknown;
      try { data = JSON.parse(text); } catch { data = null; }
      // POP invoices exist before the customer selects/submits a payment method.
      // This exact provider error is pending selection, never proof of payment.
      if (url === DUITKU_STATUS_URL && [400,404].includes(response.status) && (text.trim() === 'Transaction not found' || data && typeof data === 'object' && 'Message' in data && data.Message === 'Transaction not found')) return { notStarted: true };
      if (!response.ok) throw new Error();
      if (data === null) throw new Error();
      return data;
    } catch {
      // Never propagate SDK/network/provider bodies, credentials or signatures.
      throw new AppError(502, 'PAYMENT_GATEWAY_UNAVAILABLE', 'Pembayaran belum dapat dikonfirmasi. Coba kembali dengan pesanan yang sama.');
    }
  }
  async invoice(input: InvoiceInput) {
    const timestamp = String(Date.now());
    const data = await this.post(DUITKU_INVOICE_URL, {
      paymentAmount: input.amount, merchantOrderId: input.order, productDetails: input.productName ?? `NXBooth Sandbox - ${input.credits} kredit uji`,
      email: input.email, customerVaName: 'NXBooth Sandbox',
      itemDetails: [{ name: input.productName ?? `${input.credits} kredit uji NXBooth`, price: input.amount, quantity: 1 }],
      callbackUrl: input.callbackUrl, returnUrl: input.returnUrl, expiryPeriod: 60,
    }, { 'x-duitku-merchantcode': this.config.merchantCode, 'x-duitku-timestamp': timestamp,
      'x-duitku-signature': this.sign(this.config.merchantCode + timestamp) });
    const parsed = z.object({ merchantCode: z.literal(this.config.merchantCode), statusCode: z.literal('00'), reference: referenceSchema, paymentUrl: z.string().max(2048) }).safeParse(data);
    if (!parsed.success) throw new AppError(502, 'PAYMENT_GATEWAY_INVALID_RESPONSE', 'Checkout belum dapat dibuat. Silakan coba lagi.');
    const url = sandboxCheckoutUrl(parsed.data.paymentUrl);
    if (new URL(url).searchParams.get('reference') !== parsed.data.reference) throw new AppError(502, 'PAYMENT_GATEWAY_INVALID_RESPONSE', 'Referensi checkout tidak cocok.');
    return { reference: parsed.data.reference, checkout_url: url };
  }
  async status(order: string): Promise<VerifiedStatus | NotStartedStatus> {
    const data = await this.post(DUITKU_STATUS_URL, { merchantCode: this.config.merchantCode, merchantOrderId: order, signature: this.sign(this.config.merchantCode + order) });
    if (data && typeof data === 'object' && 'notStarted' in data && data.notStarted === true) return { notStarted: true };
    const parsed = z.object({ merchantOrderId: z.string().min(1).max(50), reference: referenceSchema,
      amount: z.union([z.string().regex(/^\d+(?:\.0{1,2})?$/), z.number().int().positive()]).transform(Number), statusCode: z.enum(['00', '01', '02']) }).safeParse(data);
    if (!parsed.success || !Number.isSafeInteger(parsed.data.amount)) throw new AppError(502, 'PAYMENT_GATEWAY_INVALID_RESPONSE', 'Status pembayaran belum dapat diverifikasi.');
    return parsed.data;
  }
  verifyCallback(input: { merchantCode: string; amount: string; merchantOrderId: string; signature: string }) {
    if (!this.available() || input.merchantCode !== this.config.merchantCode || !/^[a-fA-F0-9]{64}$/.test(input.signature)) return false;
    return timingSafeEqual(Buffer.from(input.signature, 'hex'), Buffer.from(this.sign(input.merchantCode + input.amount + input.merchantOrderId), 'hex'));
  }
}

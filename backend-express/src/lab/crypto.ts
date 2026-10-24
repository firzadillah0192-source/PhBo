import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { LabError } from './types.js';

// Credentials are encrypted at rest with a Lab-only key (LAB_ENCRYPTION_KEY). Production secrets are never reused.
export class LabVault {
  private readonly key: Buffer | null;
  constructor(secret: string) { this.key = secret.trim().length >= 16 ? createHash('sha256').update(secret.trim()).digest() : null; }
  get ready() { return this.key !== null; }
  encrypt(plain: string) {
    if (!this.key) throw new LabError(503, 'LAB_ENCRYPTION_NOT_CONFIGURED', 'Set LAB_ENCRYPTION_KEY (16+ characters) before storing provider credentials.');
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${body.toString('base64url')}`;
  }
  decrypt(blob: string) {
    if (!this.key) throw new LabError(503, 'LAB_ENCRYPTION_NOT_CONFIGURED', 'LAB_ENCRYPTION_KEY is not configured.');
    const [version, iv, tag, body] = blob.split('.');
    if (version !== 'v1' || !iv || !tag || !body) throw new LabError(500, 'LAB_CREDENTIAL_CORRUPT', 'Stored credential is unreadable. Re-enter it.');
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
    } catch { throw new LabError(500, 'LAB_CREDENTIAL_CORRUPT', 'Stored credential is unreadable. Re-enter it.'); }
  }
}
export const maskSecret = (last4: string | null) => last4 ? `••••••••${last4}` : '';
const GENERIC = [/Bearer\s+[A-Za-z0-9._~+\/=-]{8,}/gi, /\b(?:sk|key|ws|fal)[-_][A-Za-z0-9_-]{12,}/gi, /(api[_-]?key|token|secret|authorization)["'\s:=]+[A-Za-z0-9._~+\/=-]{8,}/gi];
// Provider error text is untrusted and may echo credentials; redact before storing or returning.
export function redact(text: unknown, secrets: string[] = [], max = 300) {
  let out = String(text ?? '');
  for (const secret of secrets) if (secret.length >= 6) out = out.split(secret).join('[redacted]');
  for (const pattern of GENERIC) out = out.replace(pattern, '[redacted]');
  return out.replace(/\s+/g, ' ').trim().slice(0, max);
}

import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export const accountCookie = 'photobooth_session';
export const guestCookie = 'photobooth_guest';
export const tokenHash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
export const legacyId = () => randomBytes(16).toString('hex');

const pythonBase64 = (value: Buffer) => value.toString('base64').replaceAll('+', '-').replaceAll('/', '_');
const derive = (password: string, salt: Buffer) => new Promise<Buffer>((resolve, reject) => {
  scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, digest) => error ? reject(error) : resolve(digest));
});

export async function hashCustomerPassword(password: string) {
  const salt = randomBytes(16);
  return `scrypt$16384$8$1$${pythonBase64(salt)}$${pythonBase64(await derive(password, salt))}`;
}

export async function verifyCustomerPassword(password: string, encoded: string) {
  try {
    const [scheme, n, r, p, salt, digest, extra] = encoded.split('$');
    if (scheme !== 'scrypt' || n !== '16384' || r !== '8' || p !== '1' || !salt || !digest || extra !== undefined) return false;
    const expected = Buffer.from(digest, 'base64url');
    const actual = await derive(password, Buffer.from(salt, 'base64url'));
    return expected.length === actual.length && timingSafeEqual(actual, expected);
  } catch { return false; }
}

export class CustomerCookieSigner {
  private readonly secret: string | Buffer;
  constructor(secret: string) { this.secret = secret.trim() || randomBytes(32); }
  sign(value: string) { return `${value}.${createHmac('sha256', this.secret).update(value, 'utf8').digest('hex')}`; }
  unsign(cookie: unknown): string | null {
    if (typeof cookie !== 'string' || cookie.length > 4096) return null;
    const index = cookie.lastIndexOf('.');
    if (index <= 0) return null;
    const value = cookie.slice(0, index);
    const signature = cookie.slice(index + 1);
    if (!/^[a-f0-9]{64}$/.test(signature)) return null;
    const actual = Buffer.from(signature, 'hex');
    const expected = createHmac('sha256', this.secret).update(value, 'utf8').digest();
    return timingSafeEqual(actual, expected) ? value : null;
  }
}

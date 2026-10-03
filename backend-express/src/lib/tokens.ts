import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
export const token = () => randomBytes(32).toString('base64url');
export const code = () => randomBytes(18).toString('base64url');
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const equal = (a: unknown, b: unknown) => typeof a === 'string' && typeof b === 'string' && timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));

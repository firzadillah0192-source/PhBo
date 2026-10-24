import { randomBytes, randomInt } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import { tokenHash } from './customer-credentials.service.js';

export const KIOSK_DEVICE_ROLE = 'kiosk_device';
// Who may approve (and keep) a kiosk PC: admins with the kiosk role, plus superadmins.
const KIOSK_ROLES = new Set(['kiosk_operator', 'superadmin']);
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const deviceName = z.string().trim().min(1).max(60).regex(/^[^\p{Cc}\p{Cf}]+$/u);
const userCodeSchema = z.string().max(20).transform(v => v.toUpperCase().replace(/[^A-Z0-9]/g, '')).pipe(z.string().length(8));

export type DeviceModel = {
  actor(id: string): Promise<{ id: string; name?: string; role: string; is_active: boolean; email: string | null } | null>;
  actorForEmail(email: string): Promise<{ id: string; name?: string; role: string; is_active: boolean; email: string | null } | null>;
  account(id: string): Promise<{ id: string; status: string; email: string } | null>;
  session(raw: string): Promise<{ account_id: string | null; is_admin: boolean; admin_user_id: string | null; admin_role: string | null; expires_at: Date } | null>;
  createSession(raw: string, actorId: string, accountId: string, expiresAt: Date, deviceName: string): Promise<unknown>;
  extend(raw: string, expiresAt: Date): Promise<unknown>;
};
export type DeviceConfig = { sessionDays: number; activationUrl: string; codeTtlSeconds?: number; maxPending?: number; now?: () => number };
type Pending = { userCode: string; deviceName: string; expiresAt: number; token?: string; tokenExpiresAt?: Date; staff?: { name: string; email: string } };
type WebAccount = { id: string; email: string } | null;

/**
 * Device-code login for the desktop kiosk: the PC shows a short code, an allowed staff member
 * approves it in the web app, and the PC receives a bearer token once. Pending codes live in
 * memory (single API instance, 10 minute lifetime); only the token hash is stored (auth_sessions).
 */
export class KioskDeviceService {
  private readonly pending = new Map<string, Pending>();
  constructor(private readonly model: DeviceModel, private readonly webAccount: (cookies: Record<string, unknown>) => Promise<WebAccount>, private readonly config: DeviceConfig) {}
  private now() { return this.config.now?.() ?? Date.now(); }
  private purge() { for (const [key, p] of this.pending) if (p.expiresAt <= this.now()) this.pending.delete(key); }
  private format(code: string) { return `${code.slice(0, 4)}-${code.slice(4)}`; }

  start(name: unknown) {
    this.purge();
    if (this.pending.size >= (this.config.maxPending ?? 200)) throw new AppError(503, 'DEVICE_CODES_BUSY', 'Too many pending activations. Try again shortly.');
    const parsed = deviceName.safeParse(name ?? 'Kiosk PC');
    if (!parsed.success) throw new AppError(400, 'INVALID_DEVICE_NAME', 'Device name must be 1-60 printable characters');
    let userCode: string;
    do { userCode = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(''); }
    while ([...this.pending.values()].some(p => p.userCode === userCode));
    const deviceCode = randomBytes(32).toString('base64url');
    const ttl = this.config.codeTtlSeconds ?? 600;
    this.pending.set(tokenHash(deviceCode), { userCode, deviceName: parsed.data, expiresAt: this.now() + ttl * 1000 });
    return { device_code: deviceCode, user_code: this.format(userCode), verification_url: this.config.activationUrl, expires_in: ttl, interval: 3 };
  }

  poll(deviceCode: unknown) {
    this.purge();
    if (typeof deviceCode !== 'string' || deviceCode.length < 20 || deviceCode.length > 128) throw new AppError(400, 'INVALID_DEVICE_CODE', 'Device code is invalid');
    const key = tokenHash(deviceCode), p = this.pending.get(key);
    if (!p) throw new AppError(410, 'DEVICE_CODE_EXPIRED', 'This activation code expired. Start again.');
    if (!p.token) return { status: 'pending' as const };
    this.pending.delete(key); // the token is handed over exactly once
    return { status: 'approved' as const, token: p.token, expires_at: p.tokenExpiresAt!.toISOString(), staff: p.staff };
  }

  private async approver(cookies: Record<string, unknown>) {
    const web = await this.webAccount(cookies);
    if (!web) throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Sign in to activate a kiosk.');
    const account = await this.model.account(web.id), actor = await this.model.actorForEmail(web.email);
    if (!account || account.status !== 'active' || !actor || !KIOSK_ROLES.has(actor.role)) throw new AppError(403, 'KIOSK_FORBIDDEN', 'This account is not allowed to activate kiosks.');
    return { account, actor };
  }
  private find(userCode: unknown) {
    this.purge();
    const parsed = userCodeSchema.safeParse(userCode);
    const found = parsed.success ? [...this.pending.values()].find(p => p.userCode === parsed.data) : undefined;
    if (!found) throw new AppError(404, 'DEVICE_CODE_NOT_FOUND', 'Code not found or expired. Check the code on the kiosk screen.');
    return found;
  }
  async lookup(cookies: Record<string, unknown>, userCode: unknown) {
    await this.approver(cookies);
    const p = this.find(userCode);
    return { device_name: p.deviceName, expires_in: Math.max(0, Math.round((p.expiresAt - this.now()) / 1000)), approved: Boolean(p.token) };
  }
  async approve(cookies: Record<string, unknown>, userCode: unknown) {
    const { account, actor } = await this.approver(cookies);
    const p = this.find(userCode);
    if (p.token) throw new AppError(409, 'DEVICE_ALREADY_APPROVED', 'This code was already approved.');
    const raw = randomBytes(48).toString('base64url'), expiresAt = new Date(this.now() + this.config.sessionDays * 86400000);
    await this.model.createSession(raw, actor.id, account.id, expiresAt, p.deviceName);
    p.token = raw; p.tokenExpiresAt = expiresAt; p.staff = { name: actor.name ?? account.email, email: account.email };
    return { device_name: p.deviceName };
  }

  /** Validates `Authorization: Bearer <token>`. Re-checks the staff member on every request, so deactivating them revokes their kiosks. */
  async authorize(header: string | undefined) {
    const deny = () => new AppError(401, 'UNAUTHORIZED', 'Valid kiosk sign-in required');
    const match = /^Bearer ([A-Za-z0-9_-]{40,128})$/.exec(header ?? '');
    if (!match) throw deny();
    const session = await this.model.session(match[1]);
    if (!session || session.is_admin || session.admin_role !== KIOSK_DEVICE_ROLE || !session.admin_user_id || !session.account_id || session.expires_at.getTime() <= this.now()) throw deny();
    const actor = await this.model.actor(session.admin_user_id), account = await this.model.account(session.account_id);
    if (!actor?.is_active || !KIOSK_ROLES.has(actor.role) || account?.status !== 'active' || !actor.email || actor.email.trim().toLowerCase() !== account.email.trim().toLowerCase()) throw deny();
    const lifetime = this.config.sessionDays * 86400000;
    if (session.expires_at.getTime() - this.now() < lifetime / 2) await this.model.extend(match[1], new Date(this.now() + lifetime));
    return { email: actor.email.trim().toLowerCase() };
  }
}

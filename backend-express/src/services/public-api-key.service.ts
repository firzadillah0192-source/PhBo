import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { NxAccount } from '@prisma/client';
import { AppError } from '../lib/errors.js';
import type { PublicApiKeyModel, PublicApiKeyRow } from '../models/public-api-key.model.js';

export const publicApiScopes = ['catalog:read', 'inputs:write', 'generations:create', 'generations:read', 'results:read', 'usage:read'] as const;
export type PublicApiScope = (typeof publicApiScopes)[number];
export const maxKeysPerAccount = 10;
export const rotationGraceMs = 24 * 3600000;

const keyPattern = /^nxb_live_([a-f0-9]{16})_([A-Za-z0-9_-]{43})$/;
export const keyInput = z.object({
  name: z.string().trim().min(1).max(80).regex(/^[^\p{Cc}\p{Cf}]+$/u),
  scopes: z.array(z.enum(publicApiScopes)).min(1).max(publicApiScopes.length).transform(list => [...new Set(list)]),
  expires_at: z.string().datetime().optional(),
}).strict();

const invalid = () => new AppError(401, 'API_KEY_INVALID', 'The API key is missing, invalid, expired or revoked.');
export type PublicApiPrincipal = { key: PublicApiKeyRow; account: NxAccount; scopes: ReadonlySet<string> };

export class PublicApiKeyService {
  constructor(private readonly model: PublicApiKeyModel, private readonly pepper: string) {
    if (pepper.length < 32) throw new Error('Public API key pepper must be at least 32 characters');
  }
  private hash(secret: string) { return createHmac('sha256', this.pepper).update(secret).digest('hex'); }
  public view(row: PublicApiKeyRow) {
    return { id: row.id, name: row.name, prefix: row.prefix, scopes: row.scopes, created_at: row.created_at, expires_at: row.expires_at,
      revoked_at: row.revoked_at, last_used_at: row.last_used_at, rotated_from: row.rotated_from };
  }
  private async issue(accountId: string, name: string, scopes: string[], expiresAt: Date | null, rotatedFrom: string | null, graceEnd: Date | null = null) {
    const id = randomBytes(8).toString('hex'), secret = randomBytes(32).toString('base64url');
    const row = await this.model.issueLocked({ id, account_id: accountId, name, prefix: `nxb_live_${id}`, secret_hash: this.hash(secret), scopes, expires_at: expiresAt, rotated_from: rotatedFrom }, maxKeysPerAccount, graceEnd);
    // The secret is returned only here and never stored or logged.
    return { ...this.view(row), secret: `nxb_live_${id}_${secret}` };
  }
  async create(accountId: string, body: unknown) {
    const input = keyInput.parse(body);
    const expires = input.expires_at ? new Date(input.expires_at) : null;
    if (expires && expires.getTime() <= Date.now()) throw new AppError(422, 'VALIDATION_FAILED', 'Expiry must be in the future.');
    return this.issue(accountId, input.name, input.scopes, expires, null);
  }
  async list(accountId: string) { return { keys: (await this.model.list(accountId)).map(row => this.view(row)) }; }
  async revoke(accountId: string, id: string) {
    const row = await this.model.revoke(accountId, id);
    if (!row) throw new AppError(404, 'API_KEY_NOT_FOUND', 'API key not found.');
    return this.view(row);
  }
  // Replacement is issued first; the old key keeps working for a short grace window, then expires.
  async rotate(accountId: string, id: string) {
    const old = await this.model.find(accountId, id);
    if (!old || old.revoked_at || (old.expires_at && old.expires_at.getTime() <= Date.now())) throw new AppError(404, 'API_KEY_NOT_FOUND', 'API key not found.');
    const graceEnd = new Date(Date.now() + rotationGraceMs);
    const created = await this.issue(accountId, old.name, old.scopes, old.expires_at, old.id, graceEnd);
    return { ...created, previous_key_expires_at: old.expires_at && old.expires_at < graceEnd ? old.expires_at : graceEnd };
  }
  async authenticate(header: string | undefined): Promise<PublicApiPrincipal> {
    const match = header && /^Bearer (\S+)$/.exec(header);
    const parsed = match && keyPattern.exec(match[1]);
    if (!parsed) throw invalid();
    const row = await this.model.byId(parsed[1]);
    // Hash even when the id is unknown so timing does not reveal which ids exist.
    const supplied = Buffer.from(this.hash(parsed[2]), 'hex');
    const stored = Buffer.from(row?.secret_hash ?? '0'.repeat(64), 'hex');
    if (!row || supplied.length !== stored.length || !timingSafeEqual(supplied, stored)) throw invalid();
    if (row.revoked_at || (row.expires_at && row.expires_at.getTime() <= Date.now())) throw invalid();
    const account = await this.model.account(row.account_id);
    if (!account || account.status !== 'active') throw new AppError(403, 'ACCOUNT_UNAVAILABLE', 'The account for this API key is unavailable.');
    return { key: row, account, scopes: new Set(row.scopes) };
  }
  require(principal: PublicApiPrincipal, scope: PublicApiScope) {
    if (!principal.scopes.has(scope)) throw new AppError(403, 'API_KEY_SCOPE_FORBIDDEN', `This API key lacks the ${scope} scope.`);
  }
  // Usage bookkeeping must never fail or delay a request.
  record(principal: PublicApiPrincipal, generation: boolean) { void this.model.touch(principal.key.id, generation).catch(() => {}); }
  usage(principal: PublicApiPrincipal) { return this.model.usage(principal.key.id); }
}

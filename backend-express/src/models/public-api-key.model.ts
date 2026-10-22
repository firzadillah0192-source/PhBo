import { AppError } from '../lib/errors.js';
import type { PrismaClient } from '@prisma/client';

export type PublicApiKeyRow = { id: string; account_id: string; name: string; prefix: string; secret_hash: string; scopes: string[];
  created_at: Date; expires_at: Date | null; revoked_at: Date | null; last_used_at: Date | null; rotated_from: string | null };
type NewKey = Pick<PublicApiKeyRow, 'id' | 'account_id' | 'name' | 'prefix' | 'secret_hash' | 'scopes' | 'expires_at' | 'rotated_from'>;

// Raw SQL on the additive tables from backend/migrations/025_public_api_keys.sql (no Prisma model, no schema push).
export class PublicApiKeyModel {
  constructor(private readonly db: PrismaClient, private readonly webhooksEnabled=false) {}
  async create(key: NewKey) {
    const [row] = await this.db.$queryRaw<PublicApiKeyRow[]>`INSERT INTO integration_api_keys(id,account_id,name,prefix,secret_hash,scopes,expires_at,rotated_from)
      VALUES(${key.id},${key.account_id},${key.name},${key.prefix},${key.secret_hash},${key.scopes}::text[],${key.expires_at},${key.rotated_from}) RETURNING *`;
    return row;
  }
  // Serialize issuance for one account and lock the rotated key. The cap and rotation update
  // must commit with the new key so concurrent requests cannot bypass them.
  async issueLocked(key: NewKey, maximum: number, graceEnd: Date | null) {
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM accounts WHERE id=${key.account_id} FOR UPDATE`;
      const model = new PublicApiKeyModel(tx as unknown as PrismaClient);
      if (key.rotated_from) {
        const [old] = await tx.$queryRaw<PublicApiKeyRow[]>`SELECT * FROM integration_api_keys WHERE id=${key.rotated_from} AND account_id=${key.account_id} FOR UPDATE`;
        if (!old || old.revoked_at || (old.expires_at && old.expires_at <= new Date())) throw new AppError(404, 'API_KEY_NOT_FOUND', 'API key not found.');
        key = {...key, expires_at: old.expires_at};
      }
      if (await model.activeCount(key.account_id) >= maximum) throw new AppError(409, 'API_KEY_LIMIT', `At most ${maximum} active API keys are allowed.`);
      const row = await model.create(key);
      if (key.rotated_from && graceEnd) await model.limitExpiry(key.account_id, key.rotated_from, graceEnd);
      return row;
    });
  }
  async byId(id: string) {
    const [row] = await this.db.$queryRaw<PublicApiKeyRow[]>`SELECT * FROM integration_api_keys WHERE id=${id}`;
    return row ?? null;
  }
  account(id: string) { return this.db.nxAccount.findUnique({ where: { id } }); }
  async find(accountId: string, id: string) {
    const [row] = await this.db.$queryRaw<PublicApiKeyRow[]>`SELECT * FROM integration_api_keys WHERE id=${id} AND account_id=${accountId}`;
    return row ?? null;
  }
  list(accountId: string) {
    return this.db.$queryRaw<PublicApiKeyRow[]>`SELECT * FROM integration_api_keys WHERE account_id=${accountId} ORDER BY created_at DESC,id DESC LIMIT 50`;
  }
  async activeCount(accountId: string) {
    const [row] = await this.db.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count FROM integration_api_keys WHERE account_id=${accountId} AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())`;
    return Number(row.count);
  }
  async revoke(accountId: string, id: string) {
    return this.db.$transaction(async tx=>{
      const [row] = await tx.$queryRaw<PublicApiKeyRow[]>`UPDATE integration_api_keys SET revoked_at=COALESCE(revoked_at,now()) WHERE id=${id} AND account_id=${accountId} RETURNING *`;
      if(row && this.webhooksEnabled)await tx.$executeRaw`UPDATE integration_webhook_deliveries SET state='CANCELLED',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE key_id=${id} AND account_id=${accountId} AND state IN ('PENDING','IN_FLIGHT')`;
      return row ?? null;
    });
  }
  // Only ever shortens an expiry.
  async limitExpiry(accountId: string, id: string, at: Date) {
    await this.db.$executeRaw`UPDATE integration_api_keys SET expires_at=LEAST(COALESCE(expires_at,${at}::timestamptz),${at}::timestamptz) WHERE id=${id} AND account_id=${accountId}`;
  }
  async touch(id: string, generation: boolean) {
    await this.db.$executeRaw`UPDATE integration_api_keys SET last_used_at=now() WHERE id=${id} AND (last_used_at IS NULL OR last_used_at<now()-interval '60 seconds')`;
    await this.db.$executeRaw`INSERT INTO integration_api_key_usage(key_id,day,requests,generations) VALUES(${id},(now() AT TIME ZONE 'Asia/Jakarta')::date,1,${generation ? 1 : 0})
      ON CONFLICT(key_id,day) DO UPDATE SET requests=integration_api_key_usage.requests+1,generations=integration_api_key_usage.generations+${generation ? 1 : 0}`;
  }
  async usage(id: string) {
    const rows = await this.db.$queryRaw<{ day: Date; requests: number; generations: number }[]>`SELECT day,requests,generations FROM integration_api_key_usage WHERE key_id=${id} ORDER BY day DESC LIMIT 30`;
    return rows.map(row => ({ day: row.day.toISOString().slice(0, 10), requests: row.requests, generations: row.generations }));
  }
  // Newest first; cursor is (created_at,id) of the last row already returned.
  resultIds(accountId: string, cursor: { at: Date; id: string } | null, limit: number) {
    return cursor
      ? this.db.$queryRaw<{ id: string; created_at: Date }[]>`SELECT r.id,r.created_at FROM results r JOIN generation_jobs j ON j.id=r.job_id
          WHERE j.account_id=${accountId} AND r.deleted_at IS NULL AND (r.created_at,r.id)<(${cursor.at}::timestamptz,${cursor.id}) ORDER BY r.created_at DESC,r.id DESC LIMIT ${limit}`
      : this.db.$queryRaw<{ id: string; created_at: Date }[]>`SELECT r.id,r.created_at FROM results r JOIN generation_jobs j ON j.id=r.job_id
          WHERE j.account_id=${accountId} AND r.deleted_at IS NULL ORDER BY r.created_at DESC,r.id DESC LIMIT ${limit}`;
  }
}

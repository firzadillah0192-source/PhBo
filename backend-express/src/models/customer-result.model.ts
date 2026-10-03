import type { PrismaClient, NxResult } from '@prisma/client';
import { legacyId, tokenHash } from '../services/customer-credentials.service.js';
import { AppError } from '../lib/errors.js';

export class CustomerResultModel {
  constructor(private readonly db: PrismaClient) {}
  async result(id: string) {
    const result = await this.db.nxResult.findUnique({ where: { id } });
    const job = result ? await this.db.nxGenerationJob.findUnique({ where: { id: result.job_id } }) : null;
    return result && job ? { result, job } : null;
  }
  async claim(token: string) {
    const claim = await this.db.nxResultClaim.findUnique({ where: { token_hash: tokenHash(token) } });
    const result = claim ? await this.result(claim.result_id) : null;
    return claim && result ? { claim, ...result } : null;
  }
  async createClaim(result: NxResult, input: { reuseToken?: string | null; refresh: boolean; sessionId: string; kioskSessionId: string | null; rawToken: string; expiresAt: Date }) {
    return this.db.$transaction(async tx => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM results WHERE id=${result.id} AND deleted_at IS NULL FOR UPDATE`;
      if (!locked.length) throw new AppError(404, 'CLAIM_UNAVAILABLE', 'This photo is no longer available.');
      const existing = await tx.nxResultClaim.findFirst({ where: { result_id: result.id, is_revoked: false, expires_at: { gt: new Date() } }, orderBy: { created_at: 'desc' } });
      if (existing) {
        if (!input.refresh && input.reuseToken && tokenHash(input.reuseToken) === existing.token_hash) return { claim: existing, token: input.reuseToken };
        if (!input.refresh) throw new AppError(409, 'CLAIM_EXISTS', 'A valid photo link already exists. Use the existing link or explicitly refresh it.');
        await tx.nxResultClaim.update({ where: { id: existing.id }, data: { is_revoked: true } });
        await tx.nxGenerationEvent.create({ data: { id: legacyId(), job_id: result.job_id, event_type: 'claim_revoked', detail: 'Previous public result claim replaced by explicit refresh', metadata_json: JSON.stringify({ claim_id: existing.id }) } });
      } else if (!input.refresh && await tx.nxResultClaim.findFirst({ where: { result_id: result.id } })) {
        throw new AppError(409, 'CLAIM_REFRESH_REQUIRED', 'This photo link is no longer active. Explicitly create a new link to continue.');
      }
      const claim = await tx.nxResultClaim.create({ data: { id: legacyId(), result_id: result.id, token_hash: tokenHash(input.rawToken), expires_at: input.expiresAt,
        created_by_session_id: input.sessionId, created_by_kiosk_session_id: input.kioskSessionId } });
      await tx.nxGenerationEvent.create({ data: { id: legacyId(), job_id: result.job_id, event_type: 'claim_created', detail: 'Secure result claim created', metadata_json: JSON.stringify({ claim_id: claim.id, expires_at: claim.expires_at.toISOString() }) } });
      return { claim, token: input.rawToken };
    });
  }
  async touch(claimId: string, jobId: string, download = false, opened = false) {
    await this.db.$transaction(async tx => {
      const now = new Date();
      await tx.$executeRaw`UPDATE result_claims SET first_accessed_at=COALESCE(first_accessed_at,${now}),last_accessed_at=${now},download_count=download_count+${download ? 1 : 0} WHERE id=${claimId}`;
      if (download || opened) await tx.nxGenerationEvent.create({ data: { id: legacyId(), job_id: jobId,
        event_type: download ? 'result_downloaded' : 'claim_opened', detail: download ? 'Result downloaded through public claim' : 'Public result claim accessed', metadata_json: JSON.stringify({ claim_id: claimId }) } });
    });
  }
  async expired(claimId: string, jobId: string) {
    await this.db.nxGenerationEvent.create({ data: { id: legacyId(), job_id: jobId, event_type: 'claim_expired', detail: 'Expired public result claim was requested', metadata_json: JSON.stringify({ claim_id: claimId }) } });
  }
  async markDeleted(result: NxResult, actorType: 'owner' | 'admin' = 'owner') {
    await this.db.$transaction(async tx => {
      await tx.nxResult.update({ where: { id: result.id }, data: { deleted_at: new Date() } });
      await tx.nxResultClaim.updateMany({ where: { result_id: result.id }, data: { is_revoked: true } });
      await tx.nxGenerationEvent.create({ data: { id: legacyId(), job_id: result.job_id, event_type: 'result_photo_deleted', detail: 'Generated photo deleted', metadata_json: JSON.stringify({ result_id: result.id, actor_type: actorType }) } });
    });
  }
}

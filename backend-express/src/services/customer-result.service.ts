import { randomBytes } from 'node:crypto';
import { readFile, realpath, lstat, unlink } from 'node:fs/promises';
import { resolve, dirname, parse, relative, isAbsolute } from 'node:path';
import sharp from 'sharp';
import type { NxResult } from '@prisma/client';
import type { CustomerResultModel } from '../models/customer-result.model.js';
import type { CustomerIdentity } from './customer-account.service.js';
import { AppError } from '../lib/errors.js';

export type ResultDeliveryConfig = { resultsDir: string; claimHours: number; publicOrigin: string; production: boolean; kioskResetSeconds?: number };
const unavailable = () => new AppError(404, 'CLAIM_UNAVAILABLE', 'This photo is no longer available.');

export async function classicPrintBytes(bytes: Buffer) {
  const image = await sharp(bytes, { limitInputPixels: 25_000_000 }).rotate().ensureAlpha().png().toBuffer();
  const metadata = await sharp(image).metadata();
  if (!metadata.width || !metadata.height || metadata.width * 3 !== metadata.height) throw new AppError(422, 'CLASSIC_PRINT_INVALID', 'Classic print requires a 1:3 strip');
  return sharp(image).resize(600, 1800, { kernel: 'lanczos3', fit: 'fill' }).withMetadata({ density: 300 }).png().toBuffer();
}

export class CustomerResultService {
  constructor(private readonly model: CustomerResultModel, readonly config: ResultDeliveryConfig) {}
  async owned(id: string, identity: CustomerIdentity, claim = false) {
    const found = await this.model.result(id);
    const owned = found?.job.account_id ? found.job.account_id === identity.account?.id : Boolean(found?.job.guest_id && found.job.guest_id === identity.guest?.id);
    if (!found || found.result.deleted_at || !owned) {
      if (claim) throw unavailable();
      throw new AppError(404, 'RESULT_NOT_FOUND', `result '${id}' not found`);
    }
    return found;
  }
  metadata(found: NonNullable<Awaited<ReturnType<CustomerResultModel['result']>>>) {
    const { result, job } = found;
    return { result_id: result.id, job_id: result.job_id, template_id: result.template_id, content_type: result.content_type,
      size_bytes: result.size_bytes, width: result.width, height: result.height, sha256: result.sha256,
      provider: result.provider, model: result.model, result_url: `/api/results/${result.id}`, download_url: `/api/results/${result.id}/download`,
      print_download_url: job.mode === 'CLASSIC' && result.width * 3 === result.height ? `/api/results/${result.id}/download?rendition=print` : null,
      created_at: result.created_at };
  }
  async bytes(result: NxResult, publicClaim = false) {
    try {
      const root = await realpath(this.config.resultsDir);
      const path = await realpath(result.storage_path);
      const rest = relative(root, path);
      if (rest === '..' || rest.startsWith('../') || isAbsolute(rest)) throw new Error();
      return await readFile(path);
    } catch {
      if (publicClaim) throw new AppError(404, 'CLAIM_UNAVAILABLE', 'We could not load this photo right now. Please try again.');
      throw new AppError(404, 'RESULT_NOT_FOUND', 'result file no longer exists on disk');
    }
  }
  async rendition(found: NonNullable<Awaited<ReturnType<CustomerResultModel['result']>>>, print: boolean, publicClaim = false) {
    if (print && found.job.mode !== 'CLASSIC') throw new AppError(422, 'CLASSIC_PRINT_INVALID', 'Print-strip export is available for Classic only');
    const bytes = await this.bytes(found.result, publicClaim);
    return print ? classicPrintBytes(bytes) : bytes;
  }
  publicOrigin() {
    try {
      const origin = new URL(this.config.publicOrigin);
      if (origin.username || origin.password || !['', '/'].includes(origin.pathname) || origin.search || origin.hash) throw new Error();
      if (this.config.production && origin.origin !== 'https://nxbooth.gennexbyte.com') throw new Error();
      if (!this.config.production && !['http:', 'https:'].includes(origin.protocol)) throw new Error();
      return origin.origin;
    } catch { throw new AppError(503, 'CLAIM_PUBLIC_URL_MISCONFIGURED', 'Secure photo-link delivery is temporarily unavailable.'); }
  }
  async createClaim(id: string, identity: CustomerIdentity, input: { reuseToken?: string | null; refresh: boolean; kioskSessionId: string | null }) {
    const { result } = await this.owned(id, identity, true);
    const origin = this.publicOrigin();
    const expiresAt = new Date(Math.floor(Date.now() / 1000) * 1000 + this.config.claimHours * 3600000);
    const { claim, token } = await this.model.createClaim(result, { ...input, sessionId: identity.sessionId, rawToken: randomBytes(32).toString('base64url'), expiresAt });
    const url = `${origin}/r/${encodeURIComponent(token)}`;
    return { claim_url: url, qr_payload: url, expires_at: claim.expires_at };
  }
  async publicClaim(token: string) {
    if (token.length < 32 || token.length > 256) throw unavailable();
    const found = await this.model.claim(token);
    if (!found || found.result.deleted_at || found.claim.is_revoked) throw unavailable();
    if (found.claim.expires_at <= new Date()) { await this.model.expired(found.claim.id, found.result.job_id); throw unavailable(); }
    return found;
  }
  async publicMetadata(token: string) {
    const found = await this.publicClaim(token);
    await this.model.touch(found.claim.id, found.result.job_id, false, true);
    return { image_url: `/api/public/results/${token}/image`, download_url: `/api/public/results/${token}/download`,
      print_download_url: found.job.mode === 'CLASSIC' && found.result.width * 3 === found.result.height ? `/api/public/results/${token}/download?rendition=print` : null,
      expires_at: found.claim.expires_at, created_at: found.result.created_at, content_type: found.result.content_type,
      width: found.result.width, height: found.result.height, download_count: found.claim.download_count };
  }
  touch(found: NonNullable<Awaited<ReturnType<CustomerResultModel['claim']>>>, download: boolean) { return this.model.touch(found.claim.id, found.result.job_id, download); }
  async delete(id: string, identity: CustomerIdentity, actorType: 'owner' | 'admin' = 'owner') {
    const { result } = await this.owned(id, identity);
    try {
      const path = resolve(result.storage_path);
      const root = await realpath(this.config.resultsDir).catch(() => resolve(this.config.resultsDir));
      const info = await lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      const canonical = info ? await realpath(path) : path;
      if (info?.isSymbolicLink() || dirname(canonical) !== resolve(root, result.id.slice(0, 2)) || parse(canonical).name !== result.id) throw new Error();
      if (info) await unlink(path);
    } catch { throw new AppError(500, 'RESULT_DELETE_FAILED', 'Could not delete the result photo.'); }
    await this.model.markDeleted(result, actorType);
    return { result_id: result.id, deleted: true };
  }
}

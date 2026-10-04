import { z } from 'zod';
import { code, token, hash, equal } from '../lib/tokens.js';
import { AppError } from '../lib/errors.js';
import { legacyId } from './customer-credentials.service.js';
import type { NativeKioskModel, KioskPhotoSession } from '../models/native-kiosk.model.js';
import type { CustomerIdentity } from './customer-account.service.js';
import type { CustomerUploadService } from './customer-upload.service.js';
import type { CustomerGenerationService } from './customer-generation.service.js';
import type { CustomerResultService } from './customer-result.service.js';
import type { CustomerCatalogService } from './customer-catalog.service.js';
import { eventSlug, publicCode, claimSession, requestKey } from '../objects/requests.js';

const selection = z.object({ sessionCode: publicCode, mode: z.enum(['CLASSIC','BASIC','ADVANCED']),
  photoIds: z.array(z.string().regex(/^[a-f0-9]{32}$/)).min(1).max(4).optional(),
  frameId: z.string().min(1).max(128).nullish(), templateId: z.string().min(1).max(128).nullish(),
  experienceId: z.string().min(1).max(128).nullish(), frameStyleId: z.string().min(1).max(128).nullish(),
  ornamentIds: z.array(z.string().min(1).max(128)).max(20).default([]) }).strict();

export class NativeKioskService {
  constructor(private readonly model: NativeKioskModel, private readonly uploads: CustomerUploadService,
    private readonly generations: CustomerGenerationService, readonly results: CustomerResultService,
    readonly config: { apiKey: string; ttlSeconds: number; generationLimit: number; secureCookie: boolean }) {}
  authorize(key: unknown) {
    if (!this.config.apiKey) throw new AppError(503, 'KIOSK_NOT_CONFIGURED', 'Kiosk entry is not configured');
    if (!equal(key, this.config.apiKey)) throw new AppError(401, 'UNAUTHORIZED', 'Valid Kiosk API key required');
  }
  captures(session: KioskPhotoSession): string[] { return JSON.parse(session.capture_upload_ids_json ?? '[]'); }
  available(session: KioskPhotoSession | null): asserts session is KioskPhotoSession {
    if (!session || session.status !== 'ACTIVE') throw new AppError(404, 'SESSION_NOT_FOUND', 'Photo session unavailable');
    if (session.expires_at <= new Date()) throw new AppError(410, 'SESSION_EXPIRED', 'Photo session expired');
  }
  async identity(session: KioskPhotoSession): Promise<CustomerIdentity> {
    return { account: null, guest: await this.model.guest(session.guest_id), clearAccount: false,
      newGuest: null, sessionId: `kiosk:${session.id}` };
  }
  async browser(value: unknown) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new AppError(401, 'BROWSER_SESSION_REQUIRED', 'Claim the QR before accessing this photo session');
    const session = await this.model.credential(hash(value));
    this.available(session);
    if (!session.claimed_at) throw new AppError(401, 'BROWSER_SESSION_REQUIRED', 'Claim the QR before accessing this photo session');
    return session;
  }
  async require(codeValue: unknown, credential: unknown) {
    const session = await this.browser(credential);
    if (publicCode.parse(codeValue) !== session.public_code) throw new AppError(403, 'SESSION_FORBIDDEN', 'Browser does not own this photo session');
    return session;
  }
  async info(session: KioskPhotoSession) {
    const identity = await this.identity(session);
    const photos = [];
    for (const id of this.captures(session)) {
      const { upload } = await this.uploads.owned(id, identity);
      photos.push({ id, code: id, mimeType: upload.content_type, width: upload.width, height: upload.height,
        imageUrl: `/api/v1/photos/${id}` });
    }
    const guest = identity.guest!;
    const permissions = session.event_id ? await this.model.permissions(session.event_id) : {
      availableModes: ['CLASSIC','BASIC','ADVANCED'],allowedTemplateIds: null,allowedExperienceIds: null,classicLayoutId: null };
    return { id: session.id, code: session.public_code, photos, photo: photos[0] ?? null,
      expiresAt: session.expires_at, expired: false, claimed: Boolean(session.claimed_at),
      generationLimit: guest.ai_quota_total, remainingGeneration: Math.max(0,guest.ai_quota_total-guest.ai_quota_used-guest.ai_quota_reserved),
      classicUnlimited: true,...permissions,createdAt: session.created_at };
  }
  async create(files: Express.Multer.File[], body: unknown) {
    const input = z.object({ event: eventSlug.optional() }).strict().parse(body ?? {});
    if (files.length < 1 || files.length > 4) throw new AppError(400, 'PHOTO_COUNT', 'Provide 1 to 4 photos');
    const origin = this.results.publicOrigin();
    const eventId = input.event ? await this.model.event(input.event) : null;
    const id = legacyId(), guestId = legacyId(), publicId = code(), claimToken = token();
    const expiresAt = new Date(Date.now() + Math.min(this.config.ttlSeconds,this.uploads.config.retentionHours*3600)*1000);
    await this.model.create({ id, code: publicId, eventId, guestId, claimHash: hash(claimToken), expiresAt, limit: this.config.generationLimit });
    try {
      const identity = { account: null, guest: await this.model.guest(guestId), clearAccount: false, newGuest: null, sessionId: `kiosk:${id}` };
      const ids = [];
      for (const file of files) ids.push((await this.uploads.create(file, identity,input.event)).upload_id);
      await this.model.finish(id, guestId, ids);
      const session = await this.model.find(publicId);
      this.available(session);
      const qr = new URL(`/claim/${publicId}`,origin);
      qr.hash = new URLSearchParams({ token: claimToken }).toString();
      return { ...await this.info(session), qrUrl: qr.toString(), claimToken };
    } catch (error) { await this.model.fail(id).catch(() => {}); throw error; }
  }
  async claim(codeValue: unknown, body: unknown, existing: unknown) {
    const publicId = publicCode.parse(codeValue), claimToken = claimSession.parse(body).token;
    const session = await this.model.find(publicId);
    this.available(session);
    if (!equal(hash(claimToken),session.claim_token_hash)) throw new AppError(403, 'INVALID_CLAIM_TOKEN', 'Invalid claim token');
    if (session.claimed_at) {
      if (typeof existing === 'string' && equal(hash(existing),session.access_token_hash)) return { session: await this.info(session), browser: null };
      throw new AppError(409, 'SESSION_ALREADY_CLAIMED', 'QR has already been claimed');
    }
    // Resolve all photo metadata before consuming the claim. A transient storage
    // outage must not strand a session without delivering its browser cookie.
    const info = await this.info(session);
    const access = token();
    if (!await this.model.claim(session.id,hash(claimToken),hash(access))) throw new AppError(409, 'SESSION_ALREADY_CLAIMED', 'QR is expired or already claimed');
    return { session: { ...info, claimed: true }, browser: { value: access,
      ttl: Math.max(1,Math.floor((session.expires_at.getTime()-Date.now())/1000)) } };
  }
  async photo(id: unknown, credential: unknown) {
    const session = await this.browser(credential);
    if (typeof id !== 'string' || !this.captures(session).includes(id)) throw new AppError(404, 'PHOTO_NOT_FOUND', 'Photo unavailable');
    const { upload, path } = await this.uploads.owned(id,await this.identity(session));
    return { bytes: await this.uploads.read(path), contentType: upload.content_type };
  }
  async photoDelivery(id: string,credential: unknown) {
    const session = await this.browser(credential);
    if (!this.captures(session).includes(id)) throw new AppError(404,'PHOTO_NOT_FOUND','Photo unavailable');
    return this.uploads.delivery(id,await this.identity(session),session.expires_at,'/api/v1/photos');
  }
  async photoMetadata(id: string,credential: unknown) {
    const session=await this.browser(credential);
    if (!this.captures(session).includes(id)) throw new AppError(404,'PHOTO_NOT_FOUND','Photo unavailable');
    const identity=await this.identity(session);
    const { upload }=await this.uploads.owned(id,identity);
    const delivery=await this.uploads.delivery(id,identity,session.expires_at,'/api/v1/photos');
    return { id,code:id,mimeType:upload.content_type,width:upload.width,height:upload.height,imageUrl:delivery.url,
      expiresAt:delivery.expires_at,delivery:delivery.delivery };
  }
  async frame(id: string,catalog: CustomerCatalogService) {
    const frame=(await catalog.layouts()).find(item=>item.id===id||item.slug===id);
    if (!frame) throw new AppError(404,'FRAME_NOT_FOUND','Frame unavailable');
    return frame;
  }
  async resultDelivery(id: string,credential: unknown) {
    const session = await this.browser(credential);
    return this.results.delivery(id,await this.identity(session),session.expires_at,'/api/v1/results');
  }
  generationObject(job: Awaited<ReturnType<CustomerGenerationService['status']>>, session: KioskPhotoSession) {
    return { id: job.job_id, sessionId: session.id, mode: job.mode, status: job.state,
      frameId: job.layout_id, templateId: job.template_id, experienceId: job.experience_id,
      frameStyleId: job.frame_style_id, ornamentIds: job.ornament_ids,
      resultId: job.result_id, imageUrl: job.result_id ? `/api/v1/results/${job.result_id}/image` : null,
      downloadUrl: job.result_id ? `/api/v1/results/${job.result_id}/download` : null,
      error: job.error_message, createdAt: job.created_at, updatedAt: job.updated_at };
  }
  async generate(body: unknown, credential: unknown, key: unknown) {
    const input = selection.parse(body), session = await this.require(input.sessionCode,credential);
    const photos = input.photoIds ?? (input.mode === 'CLASSIC' ? this.captures(session) : this.captures(session).slice(0,1));
    if (photos.some(id => !this.captures(session).includes(id))) throw new AppError(403, 'PHOTO_FORBIDDEN', 'Photo does not belong to session');
    if (input.mode !== 'CLASSIC' && photos.length !== 1) throw new AppError(422, 'PHOTO_COUNT', 'Only Classic accepts multiple photographs');
    const identity = await this.identity(session);
    const job = await this.generations.create({ mode: input.mode, upload_id: photos[0],
      layout_id: input.frameId, template_id: input.templateId, experience_id: input.experienceId,
      frame_style_id: input.frameStyleId, ornament_ids: input.ornamentIds,
      capture_upload_ids: input.mode === 'CLASSIC' ? photos : [] },identity,requestKey.parse(key),{ id: session.id, guestId: session.guest_id });
    return this.generationObject(await this.generations.status(job.job_id,identity),session);
  }
  async status(id: string, credential: unknown) {
    const session = await this.browser(credential);
    return this.generationObject(await this.generations.status(id,await this.identity(session)),session);
  }
  async history(codeValue: unknown, credential: unknown) {
    const session=await this.browser(credential);
    if (typeof codeValue!=='string'||(codeValue!==session.public_code&&codeValue!==session.id)) throw new AppError(403,'SESSION_FORBIDDEN','Browser does not own this photo session');
    const identity = await this.identity(session);
    return Promise.all((await this.model.jobs(session)).map(async job => this.generationObject(await this.generations.status(job.id,identity),session)));
  }
}

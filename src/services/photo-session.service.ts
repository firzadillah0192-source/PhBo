import type { SessionConfig } from '../config/env.js';
import type { PhotoSessionModel } from '../models/photo-session.model.js';
import type { BrowserId, Repository, UploadedImage } from '../types/domain.js';
import type { StorageService } from './storage.service.js';
import type { ImageService } from './image.service.js';
import type { BrowserSessionService } from './browser-session.service.js';
import { code, token, hash, equal } from '../lib/tokens.js';
import { ensure } from '../lib/errors.js';
import { sessionObject } from '../objects/responses.js';

export class PhotoSessionService {
  constructor(
    private readonly model: Repository<PhotoSessionModel>,
    private readonly storage: Pick<StorageService, 'put' | 'cleanup'>,
    private readonly images: Pick<ImageService, 'normalize'>,
    private readonly browsers: Pick<BrowserSessionService, 'create'>,
    readonly config: SessionConfig,
  ) {}
  async create(file: UploadedImage | UploadedImage[] | undefined, event?: string) {
    const files = Array.isArray(file) ? file : file ? [file] : [];
    ensure(files.length >= 1 && files.length <= 4, 400, 'PHOTO_COUNT', 'Provide 1 to 4 photos');
    const images = await Promise.all(files.map(item => this.images.normalize(item)));
    const objectIds: string[] = [];
    const claimToken = token();
    let session;
    try {
      for (const image of images) objectIds.push(await this.storage.put(image.buffer, image.mimeType, 'images', event));
      session = await this.model.create({
        code: code(), claimTokenHash: hash(claimToken),
        expiresAt: new Date(Date.now() + this.config.PHOTO_SESSION_TTL_SECONDS * 1000),
        generationLimit: this.config.GENERATION_LIMIT,
        photos: { create: images.map((image, position) => ({ code: code(), objectId: objectIds[position], mimeType: image.mimeType, width: image.width, height: image.height, position })) },
      });
    } catch (error) { await Promise.allSettled(objectIds.map(id => this.storage.cleanup(id))); throw error; }
    const qr = new URL(`/claim/${session.code}`, this.config.WEB_URL);
    qr.hash = new URLSearchParams({ token: claimToken }).toString();
    return { ...sessionObject(session), qrUrl: qr.toString(), claimToken };
  }
  async require(codeOrId: string, browserId: BrowserId) {
    const session = codeOrId.length === 36 ? await this.model.findId(codeOrId) : await this.model.find(codeOrId);
    ensure(session, 404, 'SESSION_NOT_FOUND', 'Photo session not found');
    ensure(session.id === browserId, 403, 'SESSION_FORBIDDEN', 'Browser does not own this photo session');
    ensure(session.expiresAt > new Date(), 410, 'SESSION_EXPIRED', 'Photo session expired');
    return session;
  }
  async get(code: string, browserId: BrowserId) { return sessionObject(await this.require(code, browserId)); }
  async claim(code: string, claimToken: string, browserId: BrowserId) {
    const session = await this.model.find(code);
    ensure(session, 404, 'SESSION_NOT_FOUND', 'Photo session not found');
    ensure(session.expiresAt > new Date(), 410, 'SESSION_EXPIRED', 'Photo session expired');
    ensure(equal(hash(claimToken), session.claimTokenHash), 403, 'INVALID_CLAIM_TOKEN', 'Invalid claim token');
    if (session.claimedAt && session.id === browserId) return { session: sessionObject(session), browser: null };
    ensure(!session.claimedAt, 409, 'SESSION_ALREADY_CLAIMED', 'QR has already been claimed');
    const browser = await this.browsers.create(session);
    ensure(browser, 410, 'SESSION_EXPIRED', 'Photo session expired');
    const result = await this.model.claim(session.id, hash(claimToken), hash(browser.value));
    ensure(result.count === 1, 409, 'SESSION_ALREADY_CLAIMED', 'QR is expired or already claimed');
    return { session: sessionObject({ ...session, claimedAt: new Date() }), browser };
  }
}

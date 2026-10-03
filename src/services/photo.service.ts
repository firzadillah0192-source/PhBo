import type { PhotoModel } from '../models/photo.model.js';
import type { BrowserId, Repository } from '../types/domain.js';
import type { StorageService } from './storage.service.js';
import { ensure } from '../lib/errors.js';
import { photoObject } from '../objects/responses.js';

export class PhotoService {
  constructor(private readonly model: Repository<PhotoModel>, private readonly storage: Pick<StorageService, 'url'>) {}
  async get(code: string, browserId: BrowserId) {
    const photo = await this.model.find(code);
    ensure(photo, 404, 'PHOTO_NOT_FOUND', 'Photo not found');
    ensure(photo.sessionId === browserId, 403, 'SESSION_FORBIDDEN', 'Browser does not own this photo');
    ensure(photo.session.expiresAt > new Date(), 410, 'SESSION_EXPIRED', 'Photo session expired');
    return { ...photoObject(photo), imageUrl: await this.storage.url(photo.objectId, photo.session.expiresAt) };
  }
}

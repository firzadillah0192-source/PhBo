import type { PhotoSession } from '@prisma/client';
import type { PhotoSessionModel } from '../models/photo-session.model.js';
import type { Repository } from '../types/domain.js';
import { ensure } from '../lib/errors.js';

import { hash, token } from '../lib/tokens.js';

export class BrowserSessionService {
  constructor(private readonly model: Repository<Pick<PhotoSessionModel, 'findCredential'>>) {}
  async create(session: Pick<PhotoSession, 'id' | 'expiresAt'>) {
    const value = token();
    const ttl = Math.floor((session.expiresAt.getTime() - Date.now()) / 1000);
    if (ttl < 1) return null;
    return { value, ttl };
  }
  async get(value: string | null) {
    if (!value) return null;
    const session = await this.model.findCredential(hash(value));
    if (!session || !session.claimedAt) return null;
    ensure(session.expiresAt > new Date(), 410, 'SESSION_EXPIRED', 'Photo session expired');
    return session.id;
  }
}

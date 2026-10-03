import type { PrismaClient } from '@prisma/client';
import type { CreateSessionData, SessionWithPhoto } from '../types/domain.js';

export class PhotoSessionModel {
  constructor(private readonly db: PrismaClient) {}
  async create(data: CreateSessionData): Promise<SessionWithPhoto> {
    const session = await this.db.photoSession.create({ data, include: { photos: { orderBy: { position: 'asc' } } } });
    return { ...session, photo: session.photos[0] ?? null };
  }
  async find(code: string): Promise<SessionWithPhoto | null> {
    const session = await this.db.photoSession.findUnique({ where: { code }, include: { photos: { orderBy: { position: 'asc' } } } });
    return session ? { ...session, photo: session.photos[0] ?? null } : null;
  }
  async findId(id: string): Promise<SessionWithPhoto | null> {
    const session = await this.db.photoSession.findUnique({ where: { id }, include: { photos: { orderBy: { position: 'asc' } } } });
    return session ? { ...session, photo: session.photos[0] ?? null } : null;
  }
  findCredential(accessTokenHash: string) {
    return this.db.photoSession.findUnique({ where: { accessTokenHash } });
  }
  claim(id: string, claimTokenHash: string, accessTokenHash: string) {
    return this.db.photoSession.updateMany({
      where: { id, claimTokenHash, claimedAt: null, expiresAt: { gt: new Date() } },
      data: { claimedAt: new Date(), accessTokenHash },
    });
  }
}

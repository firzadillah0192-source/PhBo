import type { PrismaClient } from '@prisma/client';

export class PhotoModel {
  constructor(private readonly db: PrismaClient) {}
  find(code: string) { return this.db.photo.findUnique({ where: { code }, include: { session: true } }); }
}

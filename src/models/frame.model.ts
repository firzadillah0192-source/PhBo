import type { PrismaClient } from '@prisma/client';
import type { CreateFrameData, UpdateFrameData } from '../types/domain.js';

export class FrameModel {
  constructor(private readonly db: PrismaClient) {}
  list() { return this.db.frame.findMany({ where: { active: true }, orderBy: { createdAt: 'desc' } }); }
  find(id: string) { return this.db.frame.findUnique({ where: { id } }); }
  create(data: CreateFrameData) { return this.db.frame.create({ data }); }
  update(id: string, data: UpdateFrameData) { return this.db.frame.update({ where: { id }, data }); }
}

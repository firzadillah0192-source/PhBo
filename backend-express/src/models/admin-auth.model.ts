import type { PrismaClient } from '@prisma/client';
import { tokenHash } from '../services/customer-credentials.service.js';
export class AdminAuthModel {
  constructor(private readonly db: PrismaClient) {}
  session(raw: string) { return this.db.nxAuthSession.findUnique({ where: { id: tokenHash(raw) } }); }
  actor(id: string) { return this.db.nxAdminUser.findUnique({ where: { id } }); }
  async login(raw: string, role: string, expires_at: Date) {
    return this.db.$transaction(async tx => {
      const actor = await tx.nxAdminUser.upsert({ where: { id: 'token-admin' }, update: {}, create: { id: 'token-admin', name: 'Configured admin token', role } });
      return tx.nxAuthSession.create({ data: { id: tokenHash(raw), is_admin: true, admin_user_id: actor.id, admin_role: actor.role, expires_at } });
    });
  }
  logout(raw: string) { return this.db.nxAuthSession.deleteMany({ where: { id: tokenHash(raw), is_admin: true } }); }
}

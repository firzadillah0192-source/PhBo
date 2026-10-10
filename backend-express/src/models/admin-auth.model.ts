import type { PrismaClient } from '@prisma/client';
import { tokenHash } from '../services/customer-credentials.service.js';
export class AdminAuthModel {
  constructor(private readonly db: PrismaClient) {}
  session(raw: string) { return this.db.nxAuthSession.findUnique({ where: { id: tokenHash(raw) } }); }
  actor(id: string) { return this.db.nxAdminUser.findUnique({ where: { id } }); }
  account(email: string) { return this.db.nxAccount.findUnique({ where: { email } }); }
  accountById(id: string) { return this.db.nxAccount.findUnique({ where: { id } }); }
  async actorForEmail(email: string) {
    const actors = await this.db.nxAdminUser.findMany({ where: { email: { equals: email, mode: 'insensitive' }, is_active: true }, take: 2 });
    return actors.length === 1 ? actors[0] : null;
  }
  async login(raw: string, actor_id: string, account_id: string, expires_at: Date) {
    return this.db.$transaction(async tx => {
      const actor = await tx.nxAdminUser.findUniqueOrThrow({ where: { id: actor_id } });
      return tx.nxAuthSession.create({ data: { id: tokenHash(raw), account_id, is_admin: true, admin_user_id: actor.id, admin_role: actor.role, expires_at } });
    });
  }
  logout(raw: string) { return this.db.nxAuthSession.deleteMany({ where: { id: tokenHash(raw), is_admin: true } }); }
}

import type { PrismaClient } from '@prisma/client';
import { legacyId, tokenHash } from '../services/customer-credentials.service.js';

// Device sessions reuse auth_sessions (no schema change): is_admin=false and admin_role='kiosk_device',
// so they can never satisfy the admin console, which only reads is_admin sessions from its own cookie.
export class KioskDeviceModel {
  constructor(private readonly db: PrismaClient) {}
  actor(id: string) { return this.db.nxAdminUser.findUnique({ where: { id } }); }
  async actorForEmail(email: string) {
    const actors = await this.db.nxAdminUser.findMany({ where: { email: { equals: email, mode: 'insensitive' }, is_active: true }, take: 2 });
    return actors.length === 1 ? actors[0] : null;
  }
  account(id: string) { return this.db.nxAccount.findUnique({ where: { id } }); }
  session(raw: string) { return this.db.nxAuthSession.findUnique({ where: { id: tokenHash(raw) } }); }
  createSession(raw: string, actorId: string, accountId: string, expiresAt: Date, deviceName: string) {
    const id = tokenHash(raw);
    return this.db.$transaction(async tx => {
      await tx.nxAuthSession.create({ data: { id, account_id: accountId, is_admin: false, admin_user_id: actorId, admin_role: 'kiosk_device', expires_at: expiresAt } });
      await tx.nxAuditLog.create({ data: { id: legacyId(), admin_actor_id: actorId, action: 'kiosk_device_approved', target_type: 'kiosk_device',
        target_id: id.slice(0, 16), reason: '', metadata_json: JSON.stringify({ device_name: deviceName }) } });
    });
  }
  extend(raw: string, expiresAt: Date) {
    return this.db.nxAuthSession.updateMany({ where: { id: tokenHash(raw), admin_role: 'kiosk_device' }, data: { expires_at: expiresAt, last_seen_at: new Date() } });
  }
}

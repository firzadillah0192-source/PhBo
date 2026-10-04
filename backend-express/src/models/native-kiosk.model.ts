import type { PrismaClient } from '@prisma/client';
import { legacyId } from '../services/customer-credentials.service.js';
import { AppError } from '../lib/errors.js';

export type KioskPhotoSession = {
  id: string; public_code: string; event_id: string | null; guest_id: string;
  status: string; claim_token_hash: string; access_token_hash: string | null;
  claimed_at: Date | null; expires_at: Date; created_at: Date;
  capture_upload_ids_json: string | null;
};
export type KioskGenerationContext = { id: string; guestId: string };

export class NativeKioskModel {
  constructor(private readonly db: PrismaClient) {}
  async event(slug: string) {
    const rows = await this.db.$queryRaw<{ id: string }[]>`SELECT id FROM events WHERE slug=${slug} AND status='published'
      AND (starts_at IS NULL OR starts_at<=now()) AND (ends_at IS NULL OR ends_at>now())`;
    if (!rows.length) throw new AppError(404, 'EVENT_UNAVAILABLE', 'Event unavailable');
    return rows[0].id;
  }
  create(input: { id: string; code: string; eventId: string | null; guestId: string; claimHash: string; expiresAt: Date; limit: number }) {
    return this.db.$transaction(async tx => {
      await tx.nxGuestSession.create({ data: { id: input.guestId, ai_quota_total: input.limit } });
      await tx.nxCreditLedger.create({ data: { id: legacyId(), guest_id: input.guestId, amount: input.limit,
        type: 'kiosk_session_grant', reason: 'Kiosk session generation allocation', idempotency_key: `kiosk_session_grant:${input.id}` } });
      await tx.$executeRaw`INSERT INTO kiosk_sessions(id,event_id,status,public_code,guest_id,claim_token_hash,expires_at)
        VALUES (${input.id},${input.eventId},'UPLOADING',${input.code},${input.guestId},${input.claimHash},${input.expiresAt})`;
    });
  }
  guest(id: string) { return this.db.nxGuestSession.findUniqueOrThrow({ where: { id } }); }
  async permissions(eventId: string) {
    const events = await this.db.$queryRaw<{ classic_enabled: boolean; basic_enabled: boolean; advanced_enabled: boolean; classic_layout_id: string | null }[]>`SELECT classic_enabled,basic_enabled,advanced_enabled,classic_layout_id FROM events
      WHERE id=${eventId} AND status='published' AND (starts_at IS NULL OR starts_at<=now()) AND (ends_at IS NULL OR ends_at>now())`;
    if (!events.length) throw new AppError(404, 'EVENT_UNAVAILABLE', 'Event unavailable');
    const event = events[0];
    const templates = await this.db.$queryRaw<{ template_id: string }[]>`SELECT template_id FROM event_basic_templates WHERE event_id=${eventId} AND enabled=true`;
    const experiences = await this.db.$queryRaw<{ experience_id: string }[]>`SELECT experience_id FROM event_advanced_experiences WHERE event_id=${eventId} AND enabled=true`;
    return { availableModes: [event.classic_enabled ? 'CLASSIC' : null,event.basic_enabled ? 'BASIC' : null,event.advanced_enabled ? 'ADVANCED' : null].filter(Boolean),
      allowedTemplateIds: templates.map(item => item.template_id),allowedExperienceIds: experiences.map(item => item.experience_id),classicLayoutId: event.classic_layout_id };
  }
  async finish(id: string, guestId: string, captures: string[]) {
    await this.db.$transaction(async tx => {
      const changed = await tx.$executeRaw`UPDATE uploads SET kiosk_session_id=${id}
        WHERE id=ANY(${captures}::varchar[]) AND guest_id=${guestId} AND account_id IS NULL`;
      if (changed !== captures.length) throw new AppError(409, 'KIOSK_UPLOAD_CONFLICT', 'Could not finish photo session');
      const ready = await tx.$executeRaw`UPDATE kiosk_sessions SET status='ACTIVE',capture_upload_ids_json=${JSON.stringify(captures)},last_activity_at=now()
        WHERE id=${id} AND guest_id=${guestId} AND status='UPLOADING' AND expires_at>now()`;
      if (ready !== 1) throw new AppError(409, 'KIOSK_UPLOAD_CONFLICT', 'Could not finish photo session');
    });
  }
  async fail(id: string) {
    await this.db.$executeRaw`UPDATE kiosk_sessions SET status='FAILED',closed_at=now() WHERE id=${id} AND status='UPLOADING'`;
  }
  async find(code: string) {
    return (await this.db.$queryRaw<KioskPhotoSession[]>`SELECT * FROM kiosk_sessions WHERE public_code=${code}`)[0] ?? null;
  }
  async credential(accessHash: string) {
    return (await this.db.$queryRaw<KioskPhotoSession[]>`SELECT * FROM kiosk_sessions WHERE access_token_hash=${accessHash}`)[0] ?? null;
  }
  async claim(id: string, claimHash: string, accessHash: string) {
    return (await this.db.$executeRaw`UPDATE kiosk_sessions SET access_token_hash=${accessHash},claimed_at=now(),last_activity_at=now()
      WHERE id=${id} AND claim_token_hash=${claimHash} AND claimed_at IS NULL AND status='ACTIVE' AND expires_at>now()`) === 1;
  }
  async jobs(session: KioskPhotoSession) {
    return this.db.$queryRaw<{ id: string }[]>`SELECT id FROM generation_jobs WHERE kiosk_session_id=${session.id}
      AND guest_id=${session.guest_id} ORDER BY created_at DESC LIMIT 100`;
  }
}

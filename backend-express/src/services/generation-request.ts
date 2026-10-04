import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { GenerationInput } from './customer-generation-input.js';
import type { CustomerIdentity } from './customer-account.service.js';
import { AppError } from '../lib/errors.js';

export type GenerationRequest = { scope: string; key: string; hash: string };
const keySchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);

export function generationRequest(key: unknown, input: GenerationInput, identity: CustomerIdentity): GenerationRequest | undefined {
  if (key === undefined) return undefined;
  const parsed = keySchema.safeParse(key);
  if (!parsed.success) throw new AppError(400, 'IDEMPOTENCY_KEY_INVALID', 'Invalid generation request key');
  const scope = identity.account ? `account:${identity.account.id}` : identity.guest ? `guest:${identity.guest.id}` : null;
  if (!scope) throw new AppError(403, 'GENERATION_OWNER_REQUIRED', 'Generation owner required');
  // Fixed field order, explicit defaults, and ordered captures. No photo bytes,
  // credentials, or claim tokens are stored in this retry record.
  const normalized = { mode: input.mode, upload_id: input.upload_id,
    template_id: input.template_id ?? null, experience_id: input.experience_id ?? null,
    layout_id: input.layout_id ?? null,
    frame_style_id: input.mode === 'ADVANCED' ? input.frame_style_id ?? 'natural' : null,
    ornament_ids: [...input.ornament_ids], capture_upload_ids: [...input.capture_upload_ids] };
  return { scope, key: parsed.data, hash: createHash('sha256').update(JSON.stringify(normalized)).digest('hex') };
}

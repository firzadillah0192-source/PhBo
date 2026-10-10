import { z } from 'zod';
import { AppError } from '../lib/errors.js';

const snapshotSchema = z.union([
  z.object({ version: z.literal(2),mode: z.literal('BASIC'),prompt: z.string().trim().min(1),model: z.string().trim().min(1),
    template: z.object({ asset: z.string().min(1),sha256: z.string().regex(/^[a-f0-9]{64}$/),
      width: z.number().int().positive().max(10000),height: z.number().int().positive().max(10000) }).strict() }).strict(),
  z.object({ version: z.literal(1),mode: z.enum(['BASIC','ADVANCED']),prompt: z.string().trim().min(1),model: z.string().trim().min(1) }).strict(),
  z.object({ version: z.literal(1),mode: z.literal('CLASSIC'),layout: z.object({
    id: z.string().min(1),slug: z.string().min(1),name: z.string().min(1),active: z.literal(true),
    canvas_width: z.literal(1200),canvas_height: z.literal(3600),shot_count: z.number().int().min(1).max(4),
    frame_asset_path: z.string().min(1),layout_config_json: z.string().min(1),
  }).strict(), personalization: z.object({ event_name: z.string().min(1).max(80), captured_at: z.string().datetime(), claim_token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict().optional() }).strict(),
]);
export type GenerationSnapshot = z.infer<typeof snapshotSchema>;
export function parseGenerationSnapshot(raw: string | null | undefined,mode: string) {
  if (raw == null) return null;
  try {
    const snapshot = snapshotSchema.parse(JSON.parse(raw));
    if (snapshot.mode!==mode) throw new Error();
    return snapshot;
  } catch { throw new AppError(422,'GENERATION_SNAPSHOT_INVALID','Saved generation configuration is invalid.'); }
}

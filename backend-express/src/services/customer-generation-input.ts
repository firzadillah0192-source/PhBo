import { z } from 'zod';
import type { NxExperience, NxFrameStyle, NxOrnament } from '@prisma/client';
import { AppError } from '../lib/errors.js';

const id = z.string().min(1);
export const generationInput = z.object({
  upload_id: id, mode: z.enum(['CLASSIC', 'BASIC', 'ADVANCED']),
  template_id: id.nullish(), experience_id: id.nullish(), layout_id: id.nullish(), frame_style_id: id.nullish(),
  capture_upload_ids: z.array(z.string()).default([]), ornament_ids: z.array(z.string()).default([]),
  event_name: z.string().trim().min(1).max(80).regex(/^[^\p{Cc}\p{Cf}]+$/u).optional(),
  captured_at: z.string().datetime().optional(),
}).strict().superRefine((value, context) => {
  const invalid = (message: string) => context.addIssue({ code: 'custom', message });
  if (value.mode === 'CLASSIC') {
    if (!value.layout_id || !value.capture_upload_ids.length || value.upload_id !== value.capture_upload_ids[0]) invalid('Classic layout and ordered captures are required');
    if (value.template_id || value.experience_id || value.frame_style_id || value.ornament_ids.length) invalid('AI selections are not accepted for Classic');
  }
  if (value.mode === 'BASIC' && (!value.template_id || value.experience_id)) invalid('Basic requires only a template');
  if (value.mode === 'ADVANCED' && (!value.experience_id || value.template_id)) invalid('Advanced requires only an experience');
  if (value.mode !== 'CLASSIC' && (value.layout_id || value.capture_upload_ids.length)) invalid('Captures are only accepted for Classic');
  if (value.event_name && value.mode !== 'CLASSIC') invalid('Event name is only accepted for Classic');
  if (value.captured_at && value.mode !== 'CLASSIC') invalid('Capture time is only accepted for Classic');
  if (value.mode !== 'ADVANCED' && (value.frame_style_id || value.ornament_ids.length)) invalid('Frame styles and ornaments are only accepted for Advanced');
});
export type GenerationInput = z.infer<typeof generationInput>;

function allowed(raw: string | null): Set<string> | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) throw new Error();
    return new Set(value);
  } catch { throw new AppError(422, 'ADVANCED_SELECTION_INVALID', 'Invalid compatibility configuration'); }
}

export function validateAdvancedSelection(experience: NxExperience, frame: NxFrameStyle | null, ornaments: NxOrnament[], requested: string[]) {
  const fail = (message: string): never => { throw new AppError(422, 'ADVANCED_SELECTION_INVALID', message); };
  if (!frame?.enabled) fail('Frame style is unavailable');
  const frames = allowed(experience.compatible_frame_style_ids_json);
  if (frames && !frames.has(frame!.id)) fail('Frame style is incompatible with this experience');
  if (new Set(requested).size !== requested.length || requested.length > experience.max_ornaments) fail('Too many or duplicate ornaments');
  const found = new Set(ornaments.map(item => item.id));
  if (found.size !== requested.length || requested.some(id => !found.has(id)) || ornaments.some(item => !item.enabled)) fail('Ornament is unavailable');
  const compatible = allowed(experience.compatible_ornament_ids_json);
  if (compatible && requested.some(id => !compatible.has(id))) fail('Ornament is incompatible with this experience');
}

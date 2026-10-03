import { z } from 'zod';

export const uuid = z.uuid();
export const publicCode = z.string().regex(/^[A-Za-z0-9_-]{24}$/);
export const eventSlug = z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/, 'Event must be a slug of up to 120 letters, digits, underscores or hyphens');
export const createPhotoSession = z.object({ event: eventSlug.optional() }).strict();
export const createFrame = z.object({ name: z.string().trim().min(1).max(120), event: eventSlug.optional() }).strict();
export const updateFrame = z.object({ name: z.string().trim().min(1).max(120).optional(), active: z.boolean().optional() }).strict().refine((v) => Object.keys(v).length > 0, 'Provide name or active');
export const claimSession = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
export const createGeneration = z.object({
  sessionCode: publicCode,
  mode: z.enum(['CLASSIC', 'BASIC', 'ADVANCED']),
  photoIds: z.array(uuid).min(1).max(4).refine(ids => new Set(ids).size === ids.length, 'Photo IDs must be unique').optional(),
  frameId: uuid.nullable().transform(value => value ?? undefined).optional(),
  templateId: z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/).nullable().transform(value => value ?? undefined).optional(),
  experienceId: z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/).nullable().transform(value => value ?? undefined).optional(),
}).strict().superRefine((v, ctx) => {
  if (v.mode !== 'CLASSIC' && (v.photoIds?.length ?? 0) > 1) ctx.addIssue({ code: 'custom', path: ['photoIds'], message: 'Only CLASSIC accepts multiple photos' });
  if (v.mode === 'CLASSIC' && v.templateId) ctx.addIssue({ code: 'custom', path: ['templateId'], message: 'CLASSIC uses a frame, not a BASIC template' });
  if (v.mode !== 'CLASSIC' && v.frameId) ctx.addIssue({ code: 'custom', path: ['frameId'], message: 'frameId is supported only for CLASSIC mode' });
  if (v.mode === 'ADVANCED' && v.templateId) ctx.addIssue({ code: 'custom', path: ['templateId'], message: 'ADVANCED uses an experience, not a template' });
  if (v.mode !== 'ADVANCED' && v.experienceId) ctx.addIssue({ code: 'custom', path: ['experienceId'], message: 'experienceId is supported only for ADVANCED mode' });
});
export const requestKey = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);

export type CreateFrameInput = z.infer<typeof createFrame>;
export type UpdateFrameInput = z.infer<typeof updateFrame>;
export type ClaimSessionInput = z.infer<typeof claimSession>;
export type CreateGenerationInput = z.infer<typeof createGeneration>;

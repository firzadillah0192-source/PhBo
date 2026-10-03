import type { Frame, Generation, Photo } from '@prisma/client';
import type { SessionWithPhoto } from '../types/domain.js';

// Public object models: never expose claim hashes, browser credentials, or leases.
export const frameObject = (frame: Frame, imageUrl: string | null) => ({
  id: frame.id, name: frame.name, objectId: frame.objectId, width: frame.width,
  height: frame.height, active: frame.active, imageUrl, createdAt: frame.createdAt,
});
export const photoObject = (photo: Photo) => ({
  id: photo.id, code: photo.code, objectId: photo.objectId, mimeType: photo.mimeType,
  width: photo.width, height: photo.height,
});
export const sessionObject = (session: SessionWithPhoto) => ({
  id: session.id, code: session.code, photo: session.photo ? photoObject(session.photo) : null,
  photos: (session.photos ?? (session.photo ? [session.photo] : [])).map(photoObject),
  expiresAt: session.expiresAt, expired: session.expiresAt <= new Date(),
  claimed: Boolean(session.claimedAt), generationLimit: session.generationLimit,
  remainingGeneration: Math.max(0, session.generationLimit - session.generationUsed),
  // generationLimit/remainingGeneration apply only to the shared AI quota.
  classicUnlimited: true,
  availableModes: ['CLASSIC', 'BASIC', 'ADVANCED'], createdAt: session.createdAt,
});
export const generationObject = (job: Generation, imageUrl: string | null = null) => ({
  id: job.id, sessionId: job.sessionId, frameId: job.frameId, mode: job.mode,
  photoIds: job.photoIds,
  status: job.status, objectId: job.objectId, imageUrl, error: job.error,
  createdAt: job.createdAt, updatedAt: job.updatedAt,
});

export type FrameObject = ReturnType<typeof frameObject>;
export type PhotoObject = ReturnType<typeof photoObject>;
export type SessionObject = ReturnType<typeof sessionObject>;
export type GenerationObject = ReturnType<typeof generationObject>;

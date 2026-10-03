import type { Frame, Generation, Photo, PhotoSession, Prisma } from '@prisma/client';
import type { EngineSnapshot } from '../services/generation-engine.service.js';

export type SessionWithPhoto = PhotoSession & { photo: Photo | null; photos?: Photo[] };
export type PhotoWithSession = Prisma.PhotoGetPayload<{ include: { session: true } }>;
export type GenerationWithSession = Prisma.GenerationGetPayload<{ include: { session: true } }>;
export type WorkerJob = Generation & { session: SessionWithPhoto; frame: Frame | null };
export type JobLease = Pick<Generation, 'id' | 'sessionId' | 'leaseToken' | 'mode'>;
export type CreateFrameData = Pick<Frame, 'name' | 'objectId' | 'width' | 'height'>;
export type UpdateFrameData = Partial<Pick<Frame, 'name' | 'active'>>;
export type CreateSessionData = Pick<PhotoSession, 'code' | 'claimTokenHash' | 'expiresAt' | 'generationLimit'> & {
  photos: { create: Array<Pick<Photo, 'code' | 'objectId' | 'mimeType' | 'width' | 'height' | 'position'>> };
};
export type CreateGenerationData = Pick<Generation, 'mode' | 'frameId' | 'requestKey'> & {
  templateId?: string | null;
  experienceId?: string | null;
  engineConfig?: EngineSnapshot;
  photoIds?: string[];
};
export type GenerationQuota = Pick<PhotoSession, 'id' | 'generationLimit'>;
export type BrowserId = string | null | undefined;
export type UploadedImage = Pick<Express.Multer.File, 'buffer'>;

// Models may return PrismaPromise; service ports also accept native Promise test doubles.
export type Repository<T> = {
  [K in keyof T]: T[K] extends (...args: infer Args) => infer Result
    ? (...args: Args) => Promise<Awaited<Result>>
    : never;
};

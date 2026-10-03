import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Generation, PhotoSession } from '@prisma/client';
import type { PhotoObject } from '../src/objects/responses.js';
import type { SessionWithPhoto, WorkerJob } from '../src/types/domain.js';

export function required<T>(value: T | null | undefined): T {
  assert.ok(value !== null && value !== undefined);
  return value;
}

// HTTP JSON is an untyped boundary; assertions in each test verify its behavior.
export function responseData<T>(response: { body: unknown }): T {
  assert.ok(typeof response.body === 'object' && response.body !== null && 'data' in response.body);
  return response.body.data as T;
}

export type UploadedSession = {
  id: string;
  code: string;
  photo: PhotoObject;
  photos: PhotoObject[];
  claimToken: string;
  qrUrl: string;
};

export function sessionFixture(): SessionWithPhoto {
  const session: PhotoSession = {
    id: randomUUID(), code: 'test-session', claimTokenHash: 'hash', accessTokenHash: null, claimedAt: null,
    expiresAt: new Date(Date.now() + 60000), generationLimit: 3,
    generationUsed: 0, createdAt: new Date(),
  };
  return {
    ...session,
    photo: { id: randomUUID(), code: 'test-photo', sessionId: session.id, objectId: randomUUID(), mimeType: 'image/png', width: 8, height: 8, position: 0, createdAt: new Date() },
  };
}

export function generationFixture(overrides: Partial<Generation> = {}): Generation {
  return {
    id: randomUUID(), sessionId: randomUUID(), frameId: null, mode: 'ORIGINAL',
    status: 'QUEUED', objectId: null, error: null, requestKey: 'key',
    templateId: null, experienceId: null, engineConfig: null,
    photoIds: [],
    attempts: 0, leaseUntil: null, leaseToken: null, createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

export function workerJobFixture(): WorkerJob {
  const session = sessionFixture();
  return { ...generationFixture({ sessionId: session.id }), session, frame: null };
}

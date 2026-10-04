import type { PrismaClient } from '@prisma/client';
import type { DispatchKind } from '../models/postgres-generation-queue.model.js';
import { PostgresGenerationQueueModel } from '../models/postgres-generation-queue.model.js';
import { PostgresGenerationQueue } from './postgres-generation-queue.service.js';
import { RedisGenerationQueue } from './redis-generation-queue.service.js';

export function nativeGenerationQueue(db: PrismaClient,config: { GENERATION_QUEUE_BACKEND: 'redis' | 'postgres'; REDIS_URL: string; QUEUE_NAME: string; PREVIEW_QUEUE_NAME: string },kind: DispatchKind) {
  return config.GENERATION_QUEUE_BACKEND === 'postgres'
    ? new PostgresGenerationQueue(new PostgresGenerationQueueModel(db),kind)
    : new RedisGenerationQueue(config.REDIS_URL,kind==='customer' ? config.QUEUE_NAME : config.PREVIEW_QUEUE_NAME);
}

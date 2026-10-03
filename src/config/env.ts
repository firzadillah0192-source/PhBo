import 'dotenv/config';
import { z } from 'zod';

const positive = (fallback: number) => z.coerce.number().int().positive().default(fallback);
const boolean = z.enum(['true', 'false']).transform((v) => v === 'true');
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: positive(3000),
  DATABASE_URL: z.string().min(1),
  WEB_URL: z.url(),
  CORS_ORIGINS: z.string().transform((v) => v.split(',').map((s) => s.trim())),
  KIOSK_API_KEY: z.string().min(32),
  ADMIN_API_KEY: z.string().min(32),
  MINIO_ENDPOINT: z.string().min(1),
  MINIO_PORT: positive(9000),
  MINIO_USE_SSL: boolean.default(false),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(8),
  MINIO_BUCKET: z.string().min(3),
  MINIO_REGION: z.string().min(1).default('us-east-1'),
  MINIO_PUBLIC_ENDPOINT: z.string().min(1),
  MINIO_PUBLIC_PORT: positive(9000),
  MINIO_PUBLIC_USE_SSL: boolean.default(false),
  PHOTO_SESSION_TTL_SECONDS: positive(86400),
  PRESIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(1).max(604800).default(300),
  GENERATION_LIMIT: positive(3),
  AI_ENGINE_URL: z.preprocess((v) => v === '' ? undefined : v, z.url().optional()),
  AI_ENGINE_API_KEY: z.string().optional(),
  BASIC_TEMPLATE_ID: z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/).default('sci-fi-space-commander-001'),
  ADVANCED_EXPERIENCE_ID: z.string().default('mini-me'),
  NINEROUTER_BASE_URL: z.preprocess((v) => v === '' ? undefined : v, z.url().optional()),
  NINEROUTER_API_KEY: z.string().optional(),
  NINEROUTER_RESULT_ORIGINS: z.string().default('').transform(v => v.split(',').map(s => s.trim()).filter(Boolean))
    .pipe(z.array(z.url().transform(v => new URL(v).origin))),
  AI_ENGINE_TIMEOUT_MS: positive(90000),
  UPLOAD_MAX_MB: z.coerce.number().int().min(1).max(25).default(10),
  WORKER_POLL_MS: positive(1000),
  WORKER_LEASE_SECONDS: positive(120),
  WORKER_MAX_ATTEMPTS: positive(3),
}).refine((config) => (!config.AI_ENGINE_URL && !config.NINEROUTER_BASE_URL) || config.AI_ENGINE_TIMEOUT_MS < config.WORKER_LEASE_SECONDS * 1000,
  { path: ['AI_ENGINE_TIMEOUT_MS'], message: 'AI timeout must be shorter than the worker lease' });

export const env = schema.parse(process.env);

export type Env = z.infer<typeof schema>;
export type ApiConfig = Pick<Env, 'NODE_ENV' | 'CORS_ORIGINS' | 'KIOSK_API_KEY' | 'ADMIN_API_KEY' | 'UPLOAD_MAX_MB'>;
export type SessionConfig = Pick<Env, 'WEB_URL' | 'PHOTO_SESSION_TTL_SECONDS' | 'GENERATION_LIMIT'>;
export type StorageConfig = Pick<Env, 'MINIO_BUCKET' | 'PRESIGNED_URL_TTL_SECONDS'>;
export type AiEngineConfig = Pick<Env, 'AI_ENGINE_URL' | 'AI_ENGINE_API_KEY' | 'AI_ENGINE_TIMEOUT_MS'>;

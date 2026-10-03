import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'minio';
import { env } from './env.js';

export const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
const credentials = { accessKey: env.MINIO_ACCESS_KEY, secretKey: env.MINIO_SECRET_KEY, region: env.MINIO_REGION };
export const minio = new Client({ ...credentials, endPoint: env.MINIO_ENDPOINT, port: env.MINIO_PORT, useSSL: env.MINIO_USE_SSL });
export const publicMinio = new Client({ ...credentials, endPoint: env.MINIO_PUBLIC_ENDPOINT, port: env.MINIO_PUBLIC_PORT, useSSL: env.MINIO_PUBLIC_USE_SSL });

export async function connect() {
  await db.$connect();
  if (!(await minio.bucketExists(env.MINIO_BUCKET))) {
    try { await minio.makeBucket(env.MINIO_BUCKET); }
    catch (error) { if (!(await minio.bucketExists(env.MINIO_BUCKET))) throw error; }
  }
}

export async function disconnect() {
  await db.$disconnect();
}

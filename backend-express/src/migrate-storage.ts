import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'minio';
import { migrationConfigSchema } from './config/migration-env.js';
import { NativeObjectStorage } from './services/native-object-storage.service.js';
import { NativeStorageMigration } from './services/native-storage-migration.service.js';

const config = migrationConfigSchema.parse(process.env);
if (config.STORAGE_BACKEND !== 'minio') throw new Error('MinIO must be configured for backfill');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: config.DATABASE_URL }) });
const objects = new NativeObjectStorage(new Client({ endPoint: config.MINIO_ENDPOINT, port: config.MINIO_PORT, useSSL: config.MINIO_USE_SSL, accessKey: config.MINIO_ACCESS_KEY, secretKey: config.MINIO_SECRET_KEY, region: config.MINIO_REGION }), config.MINIO_BUCKET);
try {
  await objects.health();
  const migration = new NativeStorageMigration(db, objects, { runtimeDir: config.RUNTIME_DIR, templatesDir: config.TEMPLATES_DIR, retentionHours: config.UPLOAD_RETENTION_HOURS });
  const report = await migration.run(process.argv.includes('--apply'), process.argv.includes('--sync-newer-metadata'));
  console.log(JSON.stringify(report));
  if (report.conflicts || report.missing_sources || report.concurrent_changes) process.exitCode = 2;
} catch {
  console.error('Storage backfill failed; inspect configuration and retry the dry-run.');
  process.exitCode = 1;
} finally { await db.$disconnect(); }

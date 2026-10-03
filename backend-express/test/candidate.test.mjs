import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireCandidateDatabase } from '../scripts/candidate-database.mjs';

const config = {
  NODE_ENV: 'test', DATABASE_URL: 'postgresql://candidate:unused@127.0.0.1:55432/nxbooth_express_test',
  WEB_URL: 'http://localhost:5173', CORS_ORIGINS: 'http://localhost:5173',
  KIOSK_API_KEY: 'k'.repeat(32), ADMIN_API_KEY: 'a'.repeat(32),
  MINIO_ENDPOINT: 'localhost', MINIO_ACCESS_KEY: 'test-access', MINIO_SECRET_KEY: 'test-secret',
  MINIO_BUCKET: 'nxbooth-express-test', MINIO_PUBLIC_ENDPOINT: 'localhost',
};
Object.assign(process.env, config);
const { schema } = await import('../src/config/env.ts');

test('candidate defaults use a separate API port and the framed Basic template', () => {
  const parsed = schema.parse(config);
  assert.equal(parsed.PORT, 8081);
  assert.equal(parsed.BASIC_TEMPLATE_ID, 'sci-fi-space-commander-framed-001');
  assert.equal(parsed.AI_ENGINE_URL, undefined);
  assert.equal(parsed.NINEROUTER_BASE_URL, undefined);
});

test('candidate config keeps provider timeout shorter than the worker lease', () => {
  assert.equal(schema.safeParse({ ...config, AI_ENGINE_URL: 'http://localhost:8001/generate', AI_ENGINE_TIMEOUT_MS: 120000 }).success, false);
});

test('candidate migration tooling accepts dedicated development and test databases', () => {
  assert.equal(requireCandidateDatabase(config), 'nxbooth_express_test');
  assert.equal(requireCandidateDatabase({ ...config, DATABASE_URL: config.DATABASE_URL.replace('_test', '_dev') }), 'nxbooth_express_dev');
});

test('candidate migration tooling rejects active database, alternate schema, and production mode', () => {
  for (const candidate of [
    { ...config, DATABASE_URL: config.DATABASE_URL.replace('nxbooth_express_test', 'photobooth') },
    { ...config, DATABASE_URL: config.DATABASE_URL + '?schema=existing' },
    { ...config, NODE_ENV: 'production' },
    { ...config, DATABASE_URL: '' },
  ]) assert.throws(() => requireCandidateDatabase(candidate));
});

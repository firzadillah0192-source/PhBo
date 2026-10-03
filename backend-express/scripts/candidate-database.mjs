// Candidate tooling only. This is not a production migration command.
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function requireCandidateDatabase(environment) {
  if (environment.NODE_ENV === 'production') throw new Error('Candidate database tooling cannot run in production');
  let url;
  try { url = new URL(environment.DATABASE_URL); }
  catch { throw new Error('Set DATABASE_URL to a dedicated candidate database'); }
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || !/^nxbooth_express_[a-z0-9_]*(?:dev|test)$/.test(database)
      || !['', 'public'].includes(url.searchParams.get('schema') ?? '')) {
    throw new Error('Use a dedicated nxbooth_express_*dev or nxbooth_express_*test database with the public schema');
  }
  return database;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireCandidateDatabase(process.env);
    const action = process.argv[2];
    if (!['deploy', 'dev', 'studio'].includes(action)) throw new Error('Expected deploy, dev, or studio');
    const args = action === 'studio' ? ['studio'] : ['migrate', action];
    execFileSync(process.execPath, [fileURLToPath(new URL('../node_modules/prisma/build/index.js', import.meta.url)), ...args], {
      cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit', env: process.env,
    });
  } catch (error) {
    // Never echo a database URL containing credentials.
    console.error(error instanceof Error ? error.message : 'Candidate database command failed');
    process.exitCode = 1;
  }
}

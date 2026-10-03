// Local development: start Python, API and the queue worker as one process group.
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import dotenv from 'dotenv';
import pg from 'pg';

const root = fileURLToPath(new URL('../', import.meta.url));
dotenv.config({ path: `${root}.env`, quiet: true });
const children = [];
let stopping = false;

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of [...children].reverse()) {
    if (child.exitCode !== null || !child.pid) continue;
    // Kill only children started here, including uv's Python child on Windows.
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already exited. */ }
    }
  }
}
process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());

function start(name, command, args) {
  const child = spawn(command, args, {
    cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true, detached: process.platform !== 'win32',
  });
  children.push(child);
  for (const [stream, output] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    stream.on('data', chunk => output.write(`[${name}] ${chunk}`));
  }
  child.on('error', error => {
    console.error(`[${name}] Cannot start (${error.code ?? 'unknown'}). Check that ${command === 'uv' ? 'uv' : 'Node.js'} is installed.`);
    shutdown(1);
  });
  child.on('exit', (code, signal) => {
    if (!stopping) {
      console.error(`[${name}] Stopped (${signal ?? code}); stopping the other processes.`);
      shutdown(code || 1);
    }
  });
  return child;
}

async function requireFreePort(port) {
  const server = createServer();
  try {
    server.listen({ port, host: '127.0.0.1', exclusive: true });
    await once(server, 'listening');
  } catch {
    throw new Error(`Port ${port} is already in use. Stop the existing API/Python process before running dev:classic.`);
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
}

async function waitForHealth(name, url, timeoutMs, expectedService) {
  const deadline = Date.now() + timeoutMs;
  while (!stopping && Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000), redirect: 'error' });
      if (response.ok) {
        const body = await response.json();
        if (body.status === 'ok' && (!expectedService || body.service === expectedService)) return;
      }
    } catch { /* Process may still be starting. */ }
    await delay(250);
  }
  if (!stopping) throw new Error(`${name} did not become ready. Check its logs above.`);
}

async function main() {
  const engine = new URL(process.env.AI_ENGINE_URL || 'http://127.0.0.1:8001/generate');
  if (engine.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(engine.hostname)
      || engine.pathname !== '/generate' || engine.username || engine.password || engine.search || engine.hash) {
    throw new Error('dev:classic requires a local AI_ENGINE_URL such as http://127.0.0.1:8001/generate.');
  }
  if (!process.env.AI_ENGINE_API_KEY) throw new Error('Set AI_ENGINE_API_KEY in backend/.env. It is shared automatically with Python.');
  const apiPort = Number(process.env.PORT || 8081);
  const pythonPort = Number(engine.port || 80);
  if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535 || pythonPort < 1 || pythonPort > 65535 || apiPort === pythonPort) {
    throw new Error('PORT must be valid and different from the Python port.');
  }
  // Both children receive the same resolved URL/key, regardless of shell cwd.
  engine.hostname = '127.0.0.1';
  process.env.AI_ENGINE_URL = engine.toString();
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in backend/.env.');
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
  try {
    await db.connect();
    // Verify migration/client prerequisites without taking any job from the queue.
    await db.query('SELECT g."photoIds", p.position FROM "Generation" g LEFT JOIN "Photo" p ON p."sessionId"=g."sessionId" LIMIT 0');
  } catch (error) {
    throw new Error(`PostgreSQL/schema check failed (${error.code ?? 'connection error'}). Start PostgreSQL and run pnpm db:migrate.`);
  } finally { await db.end(); }
  const minioProtocol = process.env.MINIO_USE_SSL === 'true' ? 'https' : 'http';
  try {
    const url = `${minioProtocol}://${process.env.MINIO_ENDPOINT}:${process.env.MINIO_PORT || 9000}/minio/health/live`;
    const response = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (!response.ok) throw new Error('unhealthy');
    await response.body?.cancel();
  } catch { throw new Error('MinIO is not reachable. Start your MinIO service using the existing data directory, then rerun pnpm dev:classic.'); }
  if (stopping) return;
  await requireFreePort(apiPort);
  await requireFreePort(pythonPort);
  if (stopping) return;
  console.log('Starting CLASSIC stack. Keep this terminal open; Ctrl+C stops all three processes.');
  start('python', 'uv', ['--cache-dir', '.local/uv-cache', 'run', '--no-project', '--python', '3.12',
    '--with-requirements', 'python-worker/requirements-classic-api.txt', 'python', '-m', 'uvicorn',
    'basic_api:api', '--app-dir', 'python-worker', '--host', '127.0.0.1', '--port', String(pythonPort)]);
  await waitForHealth('Python', new URL('/health', engine), 120000, 'classic-compositor');
  if (stopping) return;
  start('api', process.execPath, ['--import', 'tsx', 'src/server.ts']);
  await waitForHealth('API', `http://127.0.0.1:${apiPort}/health`, 15000);
  if (stopping) return;
  const worker = start('worker', process.execPath, ['--import', 'tsx', 'src/worker.ts']);
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Worker did not become ready. Check its startup logs.')), 15000);
    const done = () => { clearTimeout(timer); worker.stdout.off('data', onData); worker.off('exit', onExit); worker.off('error', onExit); };
    const onData = chunk => {
      output = (output + chunk.toString()).slice(-4096);
      if (output.includes('Generation worker started')) { done(); resolve(); }
    };
    const onExit = () => { done(); reject(new Error('Worker stopped before it was ready.')); };
    worker.stdout.on('data', onData);
    worker.once('exit', onExit);
    worker.once('error', onExit);
  });
  if (!stopping) console.log(`CLASSIC ready: API http://127.0.0.1:${apiPort}/api/v1; Python and queue worker are running.`);
}

main().catch(error => { console.error(error.message); shutdown(1); });

import { errorMessage } from './lib/errors.js';
import { setTimeout as delay } from 'node:timers/promises';
import { connect, disconnect } from './config/clients.js';
import { env } from './config/env.js';
import { generationModel, storage, images, ai } from './container.js';
import { GenerationWorkerService } from './services/generation-worker.service.js';

let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });
const worker = new GenerationWorkerService(generationModel, storage, images, ai);
try {
  await connect();
  console.log('Generation worker started');
  while (!stopping) {
    try {
      await generationModel.recover(env.WORKER_MAX_ATTEMPTS);
      const job = await generationModel.next(env.WORKER_LEASE_SECONDS);
      if (job) {
        console.log('Generation processing:', job.id, job.mode, `attempt ${job.attempts}`);
        await worker.process(job);
      }
      else await delay(env.WORKER_POLL_MS);
    } catch (error) { console.error('Worker iteration failed:', errorMessage(error)); await delay(env.WORKER_POLL_MS); }
  }
} catch (error) { console.error('Worker startup failed:', errorMessage(error)); process.exitCode = 1; }
finally { await disconnect(); }

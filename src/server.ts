import { errorMessage } from './lib/errors.js';
import { createApp } from './app.js';
import { services } from './container.js';
import { connect, disconnect } from './config/clients.js';
import { env } from './config/env.js';

try {
  await connect();
  const server = createApp(services, env).listen(env.PORT, () => console.log(`API listening on port ${env.PORT}`));
  server.on('error', async (error) => { console.error(errorMessage(error)); await disconnect(); process.exit(1); });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => process.exit(1), 10000).unref();
    server.close(async () => { await disconnect(); clearTimeout(timeout); });
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} catch (error) { console.error('Startup failed:', errorMessage(error)); await disconnect(); process.exit(1); }

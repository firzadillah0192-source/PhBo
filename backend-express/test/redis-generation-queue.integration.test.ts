import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from 'redis';
import { RedisGenerationQueue } from '../src/services/redis-generation-queue.service.js';

test('disposable Redis: native enqueue preserves LPUSH/BRPOP FIFO and handles concurrent connections', async () => {
  const socketPath = process.env.TEST_REDIS_SOCKET;
  assert.ok(socketPath?.startsWith('/tmp/nxbooth-express-redis-test-'), 'Use a dedicated disposable Redis Unix socket');
  const name = 'nxbooth:express:test:generation';
  const client = createClient({ socket: { path: socketPath, connectTimeout: 1000, reconnectStrategy: false } });
  client.on('error', () => {});
  const queue = new RedisGenerationQueue('', name, socketPath);
  try {
    await client.connect();
    assert.equal(await client.ping(), 'PONG');
    assert.equal(await queue.ping(), true);
    assert.equal(await client.exists(name), 0);
    await queue.enqueue('first'); await queue.enqueue('second');
    assert.equal(await queue.dequeue(1), 'first');
    assert.equal(await queue.dequeue(1), 'second');
    assert.equal(await queue.dequeue(1), null);
    const counter = `${name}:window`;
    try {
      const counts = await Promise.all(Array.from({ length: 10 }, () => queue.window(counter, 60)));
      assert.deepEqual(counts.sort((a,b) => a-b), Array.from({ length: 10 }, (_, i) => i+1));
      assert.ok((await client.ttl(counter)) > 0);
    } finally { await client.del(counter); }
    await queue.close();
    const concurrent = new RedisGenerationQueue('', name, socketPath);
    try {
      await Promise.all(Array.from({ length: 10 }, (_, index) => concurrent.enqueue(`job-${index}`)));
      assert.equal(await client.lLen(name), 10);
      const ids = [];
      for (let i = 0; i < 10; i++) ids.push((await client.brPop(name, 1))?.element);
      assert.equal(new Set(ids).size, 10);
    } finally { await concurrent.close(); }
    const unavailable = new RedisGenerationQueue('', name, `${socketPath}.missing`);
    try { await assert.rejects(unavailable.enqueue('must-not-queue')); }
    finally { await unavailable.close(); }
  } finally {
    await queue.close();
    if (client.isOpen) { await client.del(name); client.destroy(); }
  }
});

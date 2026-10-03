import { createClient } from 'redis';
import type { GenerationQueue } from './customer-generation.service.js';

// Match the existing Redis LPUSH/BRPOP contract. Never reuse the production
// queue in candidate validation; configure a dedicated candidate name/database.
export class RedisGenerationQueue implements GenerationQueue {
  private readonly client;
  private connecting: Promise<unknown> | null = null;
  constructor(url: string, readonly name: string, socketPath?: string) {
    this.client = createClient({ ...(socketPath ? {} : { url }), disableOfflineQueue: true,
      socket: { ...(socketPath ? { path: socketPath } : {}), connectTimeout: 5000, reconnectStrategy: false } });
    this.client.on('error', () => {}); // Errors can contain credential-bearing URLs.
  }
  private async ready() {
    if (!this.client.isReady) {
      if (!this.connecting) this.connecting = this.client.connect().finally(() => { this.connecting = null; });
      await this.connecting;
    }
  }
  async enqueue(id: string) {
    await this.ready();
    await this.client.withCommandOptions({ timeout: 5000 }).lPush(this.name, id);
  }
  async dequeue(timeoutSeconds = 2) {
    await this.ready();
    return (await this.client.withCommandOptions({ timeout: (timeoutSeconds + 5) * 1000 }).brPop(this.name, timeoutSeconds))?.element ?? null;
  }
  async ping() { await this.ready(); return (await this.client.withCommandOptions({ timeout: 5000 }).ping()) === 'PONG'; }
  async window(key: string, seconds: number) {
    await this.ready();
    return Number(await this.client.withCommandOptions({ timeout: 5000 }).eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n", { keys: [key], arguments: [String(seconds)] }));
  }
  async close() { if (this.client.isOpen) this.client.destroy(); }
}

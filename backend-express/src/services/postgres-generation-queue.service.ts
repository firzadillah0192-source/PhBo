import type { PostgresGenerationQueueModel,DispatchKind } from '../models/postgres-generation-queue.model.js';

export class PostgresGenerationQueue {
  private closed = false;
  private interrupt: (() => void) | undefined;
  constructor(private readonly model: PostgresGenerationQueueModel,readonly kind: DispatchKind) {}
  async enqueue(id: string) {
    if (this.closed) throw new Error('Generation queue is closed');
    if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid generation job identifier');
    await this.model.enqueue(this.kind,id);
  }
  async dequeue(timeoutSeconds = 2) {
    const end = Date.now()+Math.min(30,Math.max(0,timeoutSeconds))*1000;
    while (!this.closed) {
      const id = await this.model.next(this.kind);
      if (id) return id;
      const remaining = end-Date.now();
      if (remaining<=0) return null;
      await new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); this.interrupt=undefined; resolve(); };
        const timer = setTimeout(done,Math.min(250,remaining));
        this.interrupt=done;
      });
    }
    return null;
  }
  ping() { return this.model.ready(); }
  async close() { this.closed=true; this.interrupt?.(); }
}

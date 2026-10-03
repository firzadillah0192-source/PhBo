export interface NativeQueueConsumer { dequeue(seconds?: number): Promise<string | null>; close(): Promise<void> }
export class NativeWorkerLoop {
  private stopping = false;
  constructor(private readonly queue: NativeQueueConsumer, private readonly process: (id: string) => Promise<unknown>,
    private readonly maintain: () => Promise<unknown> = async () => {}, private readonly intervalMs = 60000) {}
  async run() {
    let nextMaintenance = 0;
    while (!this.stopping) {
      try {
        if (Date.now() >= nextMaintenance) { await this.maintain(); nextMaintenance = Date.now() + this.intervalMs; }
        if (this.stopping) break;
        const id = await this.queue.dequeue(2);
        if (id && /^[a-f0-9]{32}$/.test(id)) await this.process(id);
      } catch {
        // Fixed safe message: exception strings can contain paths or secrets.
        console.error('Native worker operation failed; recovery will retry durable jobs');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
  stop() { this.stopping = true; }
}

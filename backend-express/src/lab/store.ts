import type { PrismaClient } from '@prisma/client';

export type Collection = 'provider' | 'model' | 'run' | 'settings' | 'session' | 'candidate';
export interface LabStore {
  get<T>(collection: Collection, id: string): Promise<T | null>;
  put(collection: Collection, id: string, data: object): Promise<void>;
  remove(collection: Collection, id: string): Promise<void>;
  list<T>(collection: Collection, limit?: number): Promise<T[]>; // newest first
  // Serializes budget reservations across API processes (Postgres advisory lock).
  locked<T>(fn: (store: LabStore) => Promise<T>): Promise<T>;
}

export class MemoryLabStore implements LabStore {
  private readonly rows = new Map<string, { data: string; at: number; seq: number }>();
  private seq = 0; private tail: Promise<unknown> = Promise.resolve();
  async get<T>(collection: Collection, id: string) { const row = this.rows.get(`${collection}/${id}`); return row ? JSON.parse(row.data) as T : null; }
  async put(collection: Collection, id: string, data: object) { const key = `${collection}/${id}`; this.rows.set(key, { data: JSON.stringify(data), at: this.rows.get(key)?.at ?? Date.now(), seq: this.rows.get(key)?.seq ?? ++this.seq }); }
  async remove(collection: Collection, id: string) { this.rows.delete(`${collection}/${id}`); }
  async list<T>(collection: Collection, limit = 1000) {
    return [...this.rows.entries()].filter(([key]) => key.startsWith(`${collection}/`)).sort((a, b) => b[1].seq - a[1].seq).slice(0, limit).map(([, row]) => JSON.parse(row.data) as T);
  }
  locked<T>(fn: (store: LabStore) => Promise<T>): Promise<T> { const run: Promise<T> = this.tail.then(() => fn(this)); this.tail = run.catch(() => undefined); return run; }
}

type Query = Pick<PrismaClient, '$queryRaw' | '$executeRaw'>;
// Table lab_docs (backend/migrations/022_ai_provider_lab.sql). Lab data never shares a table with customer records.
export class PgLabStore implements LabStore {
  constructor(private readonly db: Query, private readonly root?: PrismaClient) {}
  async get<T>(collection: Collection, id: string) {
    const rows = await this.db.$queryRaw<{ data: T }[]>`SELECT data FROM lab_docs WHERE collection = ${collection} AND id = ${id}`;
    return rows[0]?.data ?? null;
  }
  async put(collection: Collection, id: string, data: object) {
    await this.db.$executeRaw`INSERT INTO lab_docs (collection, id, data) VALUES (${collection}, ${id}, ${JSON.stringify(data)}::jsonb)
      ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
  }
  async remove(collection: Collection, id: string) { await this.db.$executeRaw`DELETE FROM lab_docs WHERE collection = ${collection} AND id = ${id}`; }
  async list<T>(collection: Collection, limit = 1000) {
    const rows = await this.db.$queryRaw<{ data: T }[]>`SELECT data FROM lab_docs WHERE collection = ${collection} ORDER BY created_at DESC, id DESC LIMIT ${limit}`;
    return rows.map(row => row.data);
  }
  locked<T>(fn: (store: LabStore) => Promise<T>): Promise<T> {
    if (!this.root) return fn(this);
    return this.root.$transaction(async tx => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(7734001)`; return fn(new PgLabStore(tx)); });
  }
}

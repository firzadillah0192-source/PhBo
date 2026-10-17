import { appendFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';

const text = (max: number) => z.string().max(max).regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/);
const step = z.object({ name: text(40), ok: z.boolean(), ms: z.number().int().min(0).max(600000), code: text(80).optional(), detail: text(200).optional(), size_bytes: z.number().int().min(0).max(100 * 1024 * 1024).optional() }).strict();
const probe = z.object({
  ok: z.boolean(), total_ms: z.number().int().min(0).max(600000),
  cameras: z.array(z.object({ name: text(100) }).strict()).max(5),
  model: text(100).optional(), serial_tail: text(8).optional(),
  steps: z.array(step).max(16)
}).strict();
// Only fields the support person needs. No photos, no tokens, no cookies; free text is length-capped.
const reportSchema = z.object({
  app_version: z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/),
  platform: text(40), os_version: text(60), device_name: text(100).optional(),
  captured_at: z.string().datetime(),
  device_status: z.record(text(40), text(80)).refine(value => Object.keys(value).length <= 8).optional(),
  camera_probe: probe.optional(), startup_log: text(2000).optional(), note: text(500).optional()
}).strict();
export type DesktopDiagnosticsReport = z.infer<typeof reportSchema>;

const DAY_LIMIT_BYTES = 2 * 1024 * 1024, RETENTION_DAYS = 30, FILE = /^\d{4}-\d{2}-\d{2}\.jsonl$/;

// Reports from signed-in desktop kiosks are appended to one JSON-lines file per day under `dir`, for the operator to read on the server.
export class DesktopDiagnosticsService {
  constructor(private readonly dir: string, private readonly now: () => Date = () => new Date()) {}
  async record(from: string | null, input: unknown) {
    const parsed = reportSchema.safeParse(input);
    if (!parsed.success) throw new AppError(400, 'INVALID_DIAGNOSTICS', 'Diagnostics report is invalid');
    const when = this.now(), day = when.toISOString().slice(0, 10), file = join(this.dir, `${day}.jsonl`);
    await mkdir(this.dir, { recursive: true });
    const used = await stat(file).then(info => info.size, () => 0);
    if (used >= DAY_LIMIT_BYTES) throw new AppError(429, 'DIAGNOSTICS_FULL', 'Too many diagnostics today');
    const id = randomBytes(8).toString('hex');
    await appendFile(file, JSON.stringify({ id, received_at: when.toISOString(), from, report: parsed.data }) + '\n', { mode: 0o640 });
    await this.prune(when);
    return { id, stored: true as const };
  }
  private async prune(when: Date) {
    const oldest = when.getTime() - RETENTION_DAYS * 86400000;
    for (const name of await readdir(this.dir).catch(() => [] as string[])) {
      if (FILE.test(name) && Date.parse(name.slice(0, 10)) < oldest) await rm(join(this.dir, name), { force: true });
    }
  }
}

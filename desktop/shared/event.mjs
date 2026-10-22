import { readFile, writeFile, rename } from 'node:fs/promises';
import { z } from 'zod';
// Event kiosk settings kept on this PC (no server schema): which event this station runs and which templates guests may use.
const validDate = value => { const d = new Date(value + 'T00:00:00Z'); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value; };
const template = z.object({ mode: z.enum(['CLASSIC', 'BASIC', 'ADVANCED']), id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/) }).strict();
export const eventSchema = z.object({
  name: z.string().trim().normalize('NFC').min(1).max(80).regex(/^[^\p{Cc}\p{Cf}]+$/u),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(validDate),
  templates: z.array(template).min(1).max(40),
  active: z.boolean()
}).strict();
/** Seconds: countdown before each shot, window to retake the shot just taken, and idle time on the result screen before restarting. */
export const DEFAULT_TIMING = Object.freeze({ countdown: 5, retake: 4, reset: 120 });
export class EventStore {
  constructor(file) { this.file = file; this.value = null; }
  async load() {
    try { this.value = eventSchema.parse(JSON.parse(await readFile(this.file, 'utf8'))); } catch { this.value = null; }
    return this.value;
  }
  get() { return this.value; }
  async save(input) {
    const parsed = eventSchema.parse(input);
    const seen = new Set();
    parsed.templates = parsed.templates.filter(t => { const key = t.mode + ':' + t.id; return seen.has(key) ? false : (seen.add(key), true); });
    const temp = this.file + '.tmp';
    await writeFile(temp, JSON.stringify(parsed, null, 2), { mode: 0o600 });
    await rename(temp, this.file);
    this.value = parsed;
    return parsed;
  }
}

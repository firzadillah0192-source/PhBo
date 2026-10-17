import { z } from 'zod';
import { homedir } from 'node:os';
const text = max => z.string().max(max).regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/);
const step = z.object({ name: text(40), ok: z.boolean(), ms: z.number().int().min(0).max(600000), code: text(80).optional(), detail: text(200).optional(), size_bytes: z.number().int().min(0).max(100 * 1024 * 1024).optional() }).strict();
const probe = z.object({ ok: z.boolean(), total_ms: z.number().int().min(0).max(600000), cameras: z.array(z.object({ name: text(100) }).strict()).max(5), model: text(100).optional(), serial_tail: text(8).optional(), steps: z.array(step).max(16) }).strict();
// Mirrors the server schema: unknown fields never leave the PC, and the result can never contain photos, tokens or cookies.
const report = z.object({
  app_version: z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/), platform: text(40), os_version: text(60), device_name: text(100).optional(),
  captured_at: z.string().datetime(), device_status: z.record(text(40), text(80)).optional(), camera_probe: probe.optional(), startup_log: text(2000).optional(), note: text(500).optional()
}).strict();
const dropNull = value => Array.isArray(value) ? value.map(dropNull) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => [k, dropNull(v)])) : value;
/** Free text from the machine: control characters removed, the Windows profile path hidden, length capped. */
export function scrub(raw, max, home = homedir()) {
  let value = String(raw ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  if (home) value = value.split(home).join('~');
  return value.slice(-max);
}
export function buildReport({ version, platform, osVersion, deviceName, deviceStatus, probe, startupLog, note, now = new Date(), home }) {
  const status = {};
  for (const [key, val] of Object.entries(deviceStatus ?? {})) if (typeof val === 'string' && Object.keys(status).length < 8) status[scrub(key, 40, home)] = scrub(val, 80, home);
  return report.parse(dropNull({
    app_version: version, platform: scrub(platform, 40, home), os_version: scrub(osVersion, 60, home), device_name: deviceName ? scrub(deviceName, 100, home) : undefined,
    captured_at: now.toISOString(), device_status: Object.keys(status).length ? status : undefined, camera_probe: probe ?? undefined,
    startup_log: startupLog ? scrub(startupLog, 2000, home) : undefined,
    note: note ? scrub(note, 500, home) : undefined
  }));
}

import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';

const version = z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/);
const manifestSchema = z.object({
  version,
  file: z.string().regex(/^NXBooth-Setup-\d{1,4}\.\d{1,4}\.\d{1,4}\.exe$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().positive().max(500 * 1024 * 1024),
  notes: z.string().max(500).optional()
}).strict();
export type DesktopUpdateManifest = z.infer<typeof manifestSchema>;

export function isNewer(candidate: string, current: string) {
  const a = candidate.split('.').map(Number), b = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

// Installers are published by an operator into `dir` (manifest.json + the installer file).
// The API only serves what the manifest names; it never lists or serves other files.
export class DesktopUpdateService {
  constructor(private readonly dir: string) {}
  private async manifest() {
    let raw: string;
    try { raw = await readFile(join(this.dir, 'manifest.json'), 'utf8'); }
    catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
      throw new AppError(503, 'UPDATE_UNAVAILABLE', 'Desktop update store unavailable');
    }
    try { return manifestSchema.parse(JSON.parse(raw)); }
    catch { throw new AppError(503, 'UPDATE_MANIFEST_INVALID', 'Desktop update manifest is invalid'); }
  }
  async check(current: unknown) {
    const installed = version.safeParse(current);
    if (!installed.success) throw new AppError(400, 'INVALID_VERSION', 'Current version must look like 1.2.3');
    const manifest = await this.manifest();
    if (!manifest || !isNewer(manifest.version, installed.data)) return { update_available: false as const };
    return { update_available: true as const, version: manifest.version, size: manifest.size, sha256: manifest.sha256, notes: manifest.notes ?? '' };
  }
  async download() {
    const manifest = await this.manifest();
    if (!manifest) throw new AppError(404, 'UPDATE_NOT_FOUND', 'No desktop update is published');
    const file = join(this.dir, manifest.file);
    let info;
    try { info = await stat(file); } catch { throw new AppError(503, 'UPDATE_UNAVAILABLE', 'Desktop update file missing'); }
    if (!info.isFile() || info.size !== manifest.size) throw new AppError(503, 'UPDATE_MANIFEST_INVALID', 'Desktop update file does not match its manifest');
    return { name: manifest.file, size: info.size, stream: createReadStream(file) };
  }
}

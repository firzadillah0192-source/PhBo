import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import sharp from 'sharp';
import { LabError } from './types.js';

// Lab images live under <runtime>/lab/<run id>/ on private disk and are only served through admin-authenticated
// endpoints. No public or presigned URL is ever created for them.
export type LabFiles = {
  write(runId: string, name: string, bytes: Buffer): Promise<string>;
  read(runId: string, name: string): Promise<Buffer>;
  removeRun(runId: string): Promise<void>;
};
export class DiskLabFiles implements LabFiles {
  constructor(private readonly root: string) {}
  private path(runId: string, name = '') {
    if (!/^[a-f0-9]{32}$/.test(runId) || (name && !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(name))) throw new LabError(400, 'LAB_FILE_INVALID', 'Invalid file reference.');
    const full = resolve(this.root, runId, name);
    if (!full.startsWith(resolve(this.root) + sep)) throw new LabError(400, 'LAB_FILE_INVALID', 'Invalid file reference.');
    return full;
  }
  async write(runId: string, name: string, bytes: Buffer) { const path = this.path(runId, name); await mkdir(this.path(runId), { recursive: true, mode: 0o700 }); await writeFile(path, bytes, { mode: 0o600 }); return name; }
  async read(runId: string, name: string) { try { return await readFile(this.path(runId, name)); } catch (error) { if (error instanceof LabError) throw error; throw new LabError(404, 'LAB_FILE_NOT_FOUND', 'This image is no longer available (it may have expired).'); } }
  async removeRun(runId: string) { await rm(this.path(runId), { recursive: true, force: true }); }
}
export class MemoryLabFiles implements LabFiles {
  readonly files = new Map<string, Buffer>();
  async write(runId: string, name: string, bytes: Buffer) { this.files.set(`${runId}/${name}`, bytes); return name; }
  async read(runId: string, name: string) { const value = this.files.get(`${runId}/${name}`); if (!value) throw new LabError(404, 'LAB_FILE_NOT_FOUND', 'This image is no longer available (it may have expired).'); return value; }
  async removeRun(runId: string) { for (const key of [...this.files.keys()]) if (key.startsWith(`${runId}/`)) this.files.delete(key); }
}
export const newId = () => randomBytes(16).toString('hex');

export type ValidImage = { bytes: Buffer; contentType: string; ext: string; width: number; height: number };
// Validate by decoding, not by trusting the declared MIME/extension.
export async function validateImage(bytes: Buffer, limits: { maxBytes: number; minSide?: number; maxSide?: number } ): Promise<ValidImage> {
  if (!bytes.length || bytes.length > limits.maxBytes) throw new LabError(422, 'LAB_IMAGE_INVALID', 'Image is empty or exceeds the upload limit.');
  let meta;
  try { meta = await sharp(bytes, { limitInputPixels: 80_000_000 }).metadata(); await sharp(bytes, { limitInputPixels: 80_000_000 }).resize(8, 8).raw().toBuffer(); }
  catch { throw new LabError(422, 'LAB_IMAGE_INVALID', 'Image could not be read. Use JPEG, PNG or WebP.'); }
  const map: Record<string, [string, string]> = { jpeg: ['image/jpeg', 'jpg'], png: ['image/png', 'png'], webp: ['image/webp', 'webp'] };
  const found = meta.format ? map[meta.format] : undefined;
  if (!found) throw new LabError(422, 'LAB_IMAGE_INVALID', 'Only JPEG, PNG and WebP images are accepted.');
  const width = meta.width ?? 0, height = meta.height ?? 0, min = limits.minSide ?? 64, max = limits.maxSide ?? 8000;
  if (width < min || height < min || width > max || height > max) throw new LabError(422, 'LAB_IMAGE_INVALID', `Image dimensions must be between ${min} and ${max} pixels.`);
  return { bytes, contentType: found[0], ext: found[1], width, height };
}

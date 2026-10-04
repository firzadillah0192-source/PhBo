import { createHash } from 'node:crypto';
import { mkdir, writeFile, unlink, realpath, stat, readFile } from 'node:fs/promises';
import type { NativeObjectStorage } from './native-object-storage.service.js';
import { join, resolve, relative, isAbsolute } from 'node:path';
import type { NxUpload } from '@prisma/client';
import type { CustomerUploadModel } from '../models/customer-upload.model.js';
import type { UploadImageEngine } from './upload-image-engine.service.js';
import type { CustomerIdentity } from './customer-account.service.js';
import { legacyId } from './customer-credentials.service.js';
import { AppError } from '../lib/errors.js';

export class CustomerUploadService {
  constructor(private readonly model: CustomerUploadModel, private readonly engine: UploadImageEngine, readonly config: { uploadsDir: string; retentionHours: number }, private readonly objects?: NativeObjectStorage) {}
  expired(upload: NxUpload) { return upload.validation_status === 'EXPIRED' || upload.created_at.getTime() + this.config.retentionHours * 3600000 <= Date.now(); }
  response(upload: NxUpload) {
    return { upload_id: upload.id, filename: upload.filename, content_type: upload.content_type, normalized_content_type: 'image/jpeg',
      size_bytes: upload.size_bytes, width: upload.width, height: upload.height, format: upload.format, sha256: upload.sha256,
      validation_status: upload.validation_status, preview_url: `/api/uploads/${upload.id}/preview`, created_at: upload.created_at,
      expires_at: new Date(upload.created_at.getTime() + this.config.retentionHours * 3600000) };
  }
  async create(file: Express.Multer.File | undefined, identity: CustomerIdentity,eventSlug?: string) {
    if (!file?.originalname) throw new AppError(400, 'VALIDATION_FAILED', 'No file provided.');
    if (file.originalname.length > 255) throw new AppError(422, 'VALIDATION_FAILED', 'Photo filename is too long.');
    const canonical = await this.engine.normalize(file.buffer, file.mimetype);
    const id = legacyId();
    const directory = resolve(this.config.uploadsDir, id.slice(0, 2));
    const path = this.objects ? this.objects.reference('uploads', id,eventSlug) : join(directory, `${id}.jpg`);
    let created = false;
    try {
      if (this.objects) await this.objects.put(path, canonical.bytes, 'image/jpeg');
      else { await mkdir(directory, { recursive: true }); await writeFile(path, canonical.bytes, { flag: 'wx', mode: 0o600 }); }
      created = true;
      const upload = await this.model.create({ id, storage_path: path, filename: file.originalname, content_type: 'image/jpeg',
        size_bytes: canonical.bytes.length, width: canonical.width, height: canonical.height, format: 'JPEG',
        sha256: createHash('sha256').update(canonical.bytes).digest('hex'), account_id: identity.account?.id ?? null,
        guest_id: identity.guest?.id ?? null, validation_status: 'VALID' });
      return this.response(upload);
    } catch {
      if (created) await this.remove(path).catch(() => {});
      throw new AppError(503, 'UPLOAD_STORAGE_FAILED', 'We could not temporarily store this photo. Please try again.');
    }
  }
  async owned(id: string, identity: { account: { id: string } | null; guest: { id: string } | null }) {
    const upload = await this.model.find(id);
    const owned = upload?.account_id ? upload.account_id === identity.account?.id : Boolean(upload?.guest_id && upload.guest_id === identity.guest?.id);
    if (!upload || !owned) throw new AppError(404, 'UPLOAD_NOT_FOUND', 'The uploaded photo is unavailable.');
    if (this.expired(upload)) throw new AppError(410, 'UPLOAD_EXPIRED', 'The uploaded photo is no longer available. Please upload it again.');
    if (upload.validation_status !== 'VALID') throw new AppError(422, 'VALIDATION_FAILED', 'The uploaded photo did not pass validation.');
    const path = await this.path(upload.storage_path);
    if (!path) throw new AppError(404, 'UPLOAD_NOT_FOUND', 'The uploaded photo is no longer available. Please upload it again.');
    return { upload, path };
  }
  private async path(path: string) {
    if (path.startsWith('minio://')) return this.objects && await this.objects.exists(path) ? path : null;
    try {
      const root = await realpath(this.config.uploadsDir);
      const resolved = await realpath(path);
      const rest = relative(root, resolved);
      if (rest === '..' || rest.startsWith('../') || isAbsolute(rest) || !(await stat(resolved)).isFile()) return null;
      return resolved;
    } catch { return null; }
  }
  async read(path: string) {
    if (path.startsWith('minio://')) {
      if (!this.objects) throw new AppError(503, 'UPLOAD_STORAGE_FAILED', 'Photo storage unavailable.');
      return this.objects.read(path);
    }
    const safe = await this.path(path);
    if (!safe) throw new AppError(404, 'UPLOAD_NOT_FOUND', 'Photo unavailable.');
    return readFile(safe);
  }
  async delivery(id: string,identity: CustomerIdentity,notAfter?: Date,proxyPrefix='/api/uploads') {
    const { upload } = await this.owned(id,identity);
    const expires = new Date(Math.min(upload.created_at.getTime()+this.config.retentionHours*3600000,notAfter?.getTime() ?? Infinity));
    const signed = upload.storage_path.startsWith('minio://') ? await this.objects?.signedUrl(upload.storage_path,expires) : null;
    return { url: signed?.url ?? `${proxyPrefix}/${upload.id}${proxyPrefix==='/api/uploads'?'/preview':''}`,
      expires_at: signed?.expires_at ?? null,delivery: signed ? 'minio' : 'api' };
  }
  private async remove(path: string) {
    if (path.startsWith('minio://')) {
      if (!this.objects) throw new Error('Object storage unavailable');
      return this.objects.remove(path);
    }
    return unlink(path);
  }
  async cleanup() {
    const counts = { files_removed: 0, rows_removed: 0, metadata_scrubbed: 0, active_jobs_skipped: 0, unsafe_paths_skipped: 0 };
    for (const upload of await this.model.expired(new Date(Date.now() - this.config.retentionHours * 3600000))) {
      const jobs = await this.model.jobs(upload.id);
      if (jobs.some(job => ['QUEUED', 'PROCESSING'].includes(job.state))) { counts.active_jobs_skipped++; continue; }
      const path = await this.path(upload.storage_path);
      if (path) { await this.remove(path); counts.files_removed++; }
      else counts.unsafe_paths_skipped++;
      if (jobs.length) { await this.model.scrub(upload.id); counts.metadata_scrubbed++; }
      else { await this.model.remove(upload.id); counts.rows_removed++; }
    }
    return counts;
  }
}

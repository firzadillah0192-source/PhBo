import { createHash } from 'node:crypto';
import { readFile, realpath, lstat, readdir } from 'node:fs/promises';
import { join, relative, resolve, isAbsolute, extname } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import type { NativeObjectStorage } from './native-object-storage.service.js';

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export class NativeStorageMigration {
  constructor(private readonly db: PrismaClient, private readonly objects: NativeObjectStorage, private readonly config: { runtimeDir: string; templatesDir: string; retentionHours: number }) {}
  private async safeFile(path: string, root: string) {
    const info = await lstat(path);
    const canonical = await realpath(path);
    const rest = relative(await realpath(root), canonical);
    if (info.isSymbolicLink() || !info.isFile() || rest === '..' || rest.startsWith('../') || isAbsolute(rest) || info.size > 25 * 1024 * 1024) throw new Error('Unsafe or oversized source');
    return { bytes: await readFile(canonical), info };
  }
  private async copy(reference: string, bytes: Buffer, mime: string, mtime: number, apply: boolean, syncNewerMetadata = false) {
    if (!apply) return;
    if (await this.objects.exists(reference)) {
      const originalInfo = await this.objects.info(reference);
      const original = await this.objects.read(reference);
      if (digest(original) !== digest(bytes)) {
        const sourceMtime = Number(originalInfo?.metaData['nxbooth-source-mtime']);
        if (!syncNewerMetadata || !reference.startsWith('minio://catalog/') || !reference.endsWith('.json') || !sourceMtime || mtime <= sourceMtime) throw new Error('Destination conflict');
        // Keep immutable rollback bytes; only sync newer, valid JSON metadata.
        JSON.parse(bytes.toString('utf8')); JSON.parse(original.toString('utf8'));
        const history = this.objects.catalogReference(`_history/${digest(original)}/${reference.slice('minio://catalog/'.length)}`);
        if (!await this.objects.exists(history)) await this.objects.put(history, original, mime, sourceMtime);
        if (digest(await this.objects.read(history)) !== digest(original)) throw new Error('History integrity mismatch');
        if ((await this.objects.info(reference))?.etag !== originalInfo?.etag) throw new Error('Concurrent catalog change');
        await this.objects.put(reference, bytes, mime, mtime);
      }
    } else await this.objects.put(reference, bytes, mime, mtime);
    if (digest(await this.objects.read(reference)) !== digest(bytes)) throw new Error('Object integrity verification failed');
  }
  async run(apply = false, syncNewerMetadata = false) {
    const report = { apply, catalog_verified: 0, results_verified: 0, uploads_verified: 0, refs_changed: 0, refs_already_minio: 0, expired_uploads_skipped: 0, missing_sources: 0, conflicts: 0, concurrent_changes: 0 };
    const walk = async (directory: string) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) { await walk(path); continue; }
        if (!entry.isFile() || !['.png', '.jpg', '.jpeg', '.webp', '.json', '.svg'].includes(extname(entry.name).toLowerCase())) continue;
        try {
          const ref = this.objects.catalogReference(relative(resolve(this.config.templatesDir), resolve(path)));
          const { bytes, info } = await this.safeFile(path, this.config.templatesDir);
          const mime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.svg': 'image/svg+xml' } as Record<string, string>)[extname(path).toLowerCase()];
          await this.copy(ref, bytes, mime, info.mtimeMs, apply, syncNewerMetadata); report.catalog_verified++;
        } catch (error) {
          if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') report.missing_sources++;
          else report.conflicts++;
        }
      }
    };
    await walk(this.config.templatesDir);
    const results = await this.db.nxResult.findMany({ where: { deleted_at: null } });
    for (const row of results) {
      if (row.storage_path.startsWith('minio://')) { report.refs_already_minio++; continue; }
      try {
        const { bytes, info } = await this.safeFile(row.storage_path, join(this.config.runtimeDir, 'results'));
        if (bytes.length !== row.size_bytes || digest(bytes) !== row.sha256) throw new Error('Source integrity mismatch');
        const ref = this.objects.reference('results', row.id);
        await this.copy(ref, bytes, row.content_type, info.mtimeMs, apply); report.results_verified++;
        if (apply) {
          const changed = await this.db.nxResult.updateMany({ where: { id: row.id, storage_path: row.storage_path, deleted_at: null }, data: { storage_path: ref } });
          report.refs_changed += changed.count;
          if (!changed.count) {
            report.concurrent_changes++;
            const current = await this.db.nxResult.findUnique({ where: { id: row.id } });
            if (!current || current.deleted_at || current.storage_path !== ref) await this.objects.remove(ref);
          }
        }
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') report.missing_sources++;
        else report.conflicts++;
      }
    }
    const uploads = await this.db.nxUpload.findMany({ where: { storage_path: { not: '' } } });
    for (const row of uploads) {
      if (row.storage_path.startsWith('minio://')) { report.refs_already_minio++; continue; }
      if (row.validation_status !== 'VALID' || row.created_at.getTime() + this.config.retentionHours * 3600000 <= Date.now()) { report.expired_uploads_skipped++; continue; }
      try {
        const { bytes, info } = await this.safeFile(row.storage_path, join(this.config.runtimeDir, 'uploads'));
        if (bytes.length !== row.size_bytes || digest(bytes) !== row.sha256) throw new Error('Source integrity mismatch');
        const ref = this.objects.reference('uploads', row.id);
        await this.copy(ref, bytes, row.content_type, info.mtimeMs, apply); report.uploads_verified++;
        if (apply) {
          const changed = await this.db.nxUpload.updateMany({ where: { id: row.id, storage_path: row.storage_path, sha256: row.sha256, validation_status: 'VALID', created_at: { gt: new Date(Date.now() - this.config.retentionHours * 3600000) } }, data: { storage_path: ref } });
          report.refs_changed += changed.count;
          if (!changed.count) {
            report.concurrent_changes++;
            const current = await this.db.nxUpload.findUnique({ where: { id: row.id } });
            if (!current || current.storage_path !== ref) await this.objects.remove(ref);
          }
        }
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') report.missing_sources++;
        else report.conflicts++;
      }
    }
    return report;
  }
}

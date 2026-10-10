import { readFile, realpath, stat, mkdir, writeFile, rename, unlink, utimes } from 'node:fs/promises';
import { resolve, relative, isAbsolute, join, extname, dirname, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { NxClassicLayout, NxTemplate } from '@prisma/client';
import type { NativeObjectStorage } from './native-object-storage.service.js';

export class CatalogAssetError extends Error {
  constructor() { super('Catalog asset unavailable'); }
}

export type ClassicSlot = { x: number; y: number; width: number; height: number; fit?: 'cover' };
export type LayoutConfig = { slots: ClassicSlot[]; theme_slug?: string; theme_name?: string };

export function reviewedSlots(row: NxClassicLayout): LayoutConfig {
  let config: LayoutConfig;
  try { config = JSON.parse(row.layout_config_json); } catch { throw new CatalogAssetError(); }
  if (!config || !Array.isArray(config.slots) || !config.slots.length || config.slots.length !== row.shot_count) throw new CatalogAssetError();
  for (const slot of config.slots) {
    if (!slot || ![slot.x, slot.y, slot.width, slot.height].every(Number.isInteger)
        || slot.x < 0 || slot.y < 0 || slot.width <= 0 || slot.height <= 0
        || slot.x + slot.width > row.canvas_width || slot.y + slot.height > row.canvas_height
        || (slot.fit ?? 'cover') !== 'cover') throw new CatalogAssetError();
  }
  return config;
}

export class CatalogAssetsService {
  private readonly validated = new Map<string, Promise<void>>();
  private readonly downloads = new Map<string, Promise<string>>();
  constructor(private readonly roots: readonly string[], private readonly templatesDir: string, private readonly objects?: NativeObjectStorage, private readonly cacheDir = join(templatesDir, '.minio-cache')) {}
  objectReference(path: string) {
    if (!this.objects) return null;
    if (path.startsWith('minio://catalog/')) { this.objects.catalogReference(path.slice('minio://catalog/'.length)); return path; }
    const rest = relative(resolve(this.templatesDir), resolve(path));
    if (!rest || rest === '..' || rest.startsWith('../') || isAbsolute(rest)) return null;
    return this.objects.catalogReference(rest);
  }
  async store(path: string, bytes: Buffer, mime = 'image/png') {
    const ref = this.objectReference(path);
    if (!ref || !this.objects) return null;
    await this.objects.put(ref, bytes, mime);
    return ref;
  }
  async removeObject(reference: string) {
    if (!this.objects || !reference.startsWith('minio://catalog/')) throw new CatalogAssetError();
    await this.objects.remove(reference);
  }
  private async materialize(reference: string) {
    const info = await this.objects!.info(reference);
    if (!info) return null;
    if (info.size > 25 * 1024 * 1024) throw new CatalogAssetError();
    const version = createHash('sha256').update(JSON.stringify([this.objects!.bucket, reference, info.etag, info.lastModified, info.size])).digest('hex');
    const target = join(this.cacheDir, `${version}${extname(reference)}`);
    try { if ((await stat(target)).isFile()) return target; } catch {}
    let pending = this.downloads.get(target);
    if (!pending) {
      pending = (async () => {
        const bytes = await this.objects!.read(reference);
        await mkdir(this.cacheDir, { recursive: true });
        const temporary = `${target}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
          const sourceMtime = Number(info.metaData?.['nxbooth-source-mtime']);
          const modified = Number.isFinite(sourceMtime) && sourceMtime > 0 ? new Date(sourceMtime) : info.lastModified;
          if (modified) await utimes(temporary, modified, modified);
          await rename(temporary, target);
        }
        finally { await unlink(temporary).catch(() => {}); }
        return target;
      })();
      this.downloads.set(target, pending);
    }
    try { return await pending; } finally { this.downloads.delete(target); }
  }
  async exists(path: string | null) {
    if (!path) return false;
    if (path.startsWith('minio://')) return this.objects ? this.objects.exists(path) : false;
    return Boolean(await this.file(path));
  }

  async file(path: string | null): Promise<string | null> {
    if (!path) return null;
    if (path.startsWith('minio://')) {
      if (!this.objects || !path.startsWith('minio://catalog/')) return null;
      return this.materialize(path);
    }
    const ref = this.objectReference(path);
    if (ref) { const cached = await this.materialize(ref); if (cached) return cached; }
    try {
      const canonical = await realpath(path);
      for (const root of this.roots) {
        const rootPath = await realpath(root).catch(() => resolve(root));
        const rest = relative(rootPath, canonical);
        if (rest !== '..' && !rest.startsWith('../') && !isAbsolute(rest) && (await stat(canonical)).isFile()) return canonical;
      }
    } catch { /* Missing managed asset is not a public filesystem error. */ }
    return null;
  }

  async templateMetadata(row: NxTemplate) {
    // The Python registry reads <TEMPLATES_DIR>/<id>/template.json, independently
    // of admin metadata_path. Match it rather than infer face geometry from PNGs.
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(row.id)) return { width: 1024, height: 1024, face_region: null };
    const path = await this.file(join(this.templatesDir, row.id, 'template.json'));
    if (!path) return { width: 1024, height: 1024, face_region: null };
    try {
      const metadata = JSON.parse(await readFile(path, 'utf8'));
      return { width: metadata.width ?? 1024, height: metadata.height ?? 1024, face_region: metadata.face_region ?? null };
    } catch { return { width: 1024, height: 1024, face_region: null }; }
  }

  async templateDefinition(row: NxTemplate) {
    const path = /^[a-zA-Z0-9_-]{1,128}$/.test(row.id) ? await this.file(join(this.templatesDir, row.id, 'template.json')) : null;
    if (!path) throw new CatalogAssetError();
    try {
      const data = JSON.parse(await readFile(path, 'utf8'));
      return { ...data, id: row.id, name: row.name, description: row.description };
    } catch { throw new CatalogAssetError(); }
  }

  async validateLayout(row: NxClassicLayout) {
    const config = reviewedSlots(row);
    const path = await this.file(row.frame_asset_path);
    if (!path) throw new CatalogAssetError();
    const info = await stat(path);
    const key = JSON.stringify([path, info.mtimeMs, info.size, row.canvas_width, row.canvas_height, row.shot_count, row.layout_config_json]);
    let validation = this.validated.get(key);
    if (!validation) {
      validation = this.validatePng(path, row, config);
      if (this.validated.size >= 128) this.validated.delete(this.validated.keys().next().value!);
      this.validated.set(key, validation);
      validation.catch(() => this.validated.delete(key));
    }
    await validation;
    return config;
  }

  async freezeLayout(row: NxClassicLayout) {
    if (row.canvas_width!==1200 || row.canvas_height!==3600) throw new CatalogAssetError();
    await this.validateLayout(row);
    const source = await this.file(row.frame_asset_path);
    if (!source) throw new CatalogAssetError();
    const bytes = await readFile(source);
    const digest = createHash('sha256').update(bytes).digest('hex');
    const path = join(this.templatesDir,'_job_frames',`${digest}.png`);
    const reference = this.objectReference(path);
    if (!reference || !await this.exists(reference)) {
      if (!await this.store(path,bytes)) {
        await mkdir(dirname(path),{ recursive: true });
        try { await writeFile(path,bytes,{ flag: 'wx',mode: 0o600 }); }
        catch (error) { if (!(error && typeof error==='object' && 'code' in error && error.code==='EEXIST')) throw error; }
      }
    }
    return { id: row.id,slug: row.slug,name: row.name,active: true as const,
      canvas_width: 1200 as const,canvas_height: 3600 as const,shot_count: row.shot_count,
      frame_asset_path: reference ?? path,layout_config_json: row.layout_config_json };
  }

  async freezeBasicTemplate(row: NxTemplate) {
    const source = await this.file(row.image_path);
    if (!source) throw new CatalogAssetError();
    const bytes = await readFile(source);
    const image = sharp(bytes, { limitInputPixels: 25_000_000 });
    const info = await image.metadata(); await image.stats();
    if (info.format !== 'png' || !info.width || !info.height || (info.orientation && info.orientation !== 1)) throw new CatalogAssetError();
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const path = join(this.templatesDir, '_job_templates', `${sha256}.png`);
    const reference = this.objectReference(path);
    if (!reference || !await this.exists(reference)) {
      if (!await this.store(path, bytes)) {
        await mkdir(dirname(path), { recursive: true });
        try { await writeFile(path, bytes, { flag: 'wx', mode: 0o600 }); }
        catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error; }
      }
    }
    return { asset: reference ?? path, sha256, width: info.width, height: info.height };
  }

  private async validatePng(path: string, row: NxClassicLayout, config: LayoutConfig) {
    try {
      const image = sharp(path, { limitInputPixels: 25_000_000 });
      const metadata = await image.metadata();
      if (metadata.format !== 'png' || !metadata.hasAlpha || metadata.width !== row.canvas_width || metadata.height !== row.canvas_height) throw new CatalogAssetError();
      for (const slot of config.slots) {
        const { data, info } = await image.clone().extract({ left: slot.x, top: slot.y, width: slot.width, height: slot.height }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const alpha = info.channels - 1;
        const center = (Math.floor(slot.height / 2) * slot.width + Math.floor(slot.width / 2)) * info.channels + alpha;
        let transparent = 0;
        for (let index = alpha; index < data.length; index += info.channels) if (data[index] === 0) transparent++;
        if (data[center] !== 0 || transparent < slot.width * slot.height * 0.85) throw new CatalogAssetError();
      }
    } catch { throw new CatalogAssetError(); }
  }

  async classicPreview(row: NxClassicLayout) {
    await this.validateLayout(row);
    const master = await this.file(row.frame_asset_path);
    if (!master) throw new CatalogAssetError();
    const original = row.frame_asset_path!;
    const previewRef = original.startsWith('minio://catalog/') ? original.replace(/\/([^/]+)$/, '/previews/$1') : join(dirname(original), 'previews', basename(original));
    const preview = await this.file(previewRef);
    return preview && (await stat(preview)).mtimeMs >= (await stat(master)).mtimeMs ? preview : master;
  }
}

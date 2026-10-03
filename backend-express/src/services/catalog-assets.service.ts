import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, join } from 'node:path';
import sharp from 'sharp';
import type { NxClassicLayout, NxTemplate } from '@prisma/client';

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
  constructor(private readonly roots: readonly string[], private readonly templatesDir: string) {}

  async file(path: string | null): Promise<string | null> {
    if (!path) return null;
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
    const { dirname, basename } = await import('node:path');
    const preview = await this.file(join(dirname(master), 'previews', basename(master)));
    return preview && (await stat(preview)).mtimeMs >= (await stat(master)).mtimeMs ? preview : master;
  }
}

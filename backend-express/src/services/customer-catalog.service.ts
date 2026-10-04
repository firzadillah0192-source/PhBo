import type { CustomerCatalogModel } from '../models/customer-catalog.model.js';
import { CatalogAssetError, CatalogAssetsService } from './catalog-assets.service.js';
import { AppError } from '../lib/errors.js';

const missing = (message: string) => new AppError(404, 'CATALOG_ASSET_NOT_FOUND', message);
type CatalogRepository = {
  [Key in keyof CustomerCatalogModel]: (...args: Parameters<CustomerCatalogModel[Key]>) => Promise<Awaited<ReturnType<CustomerCatalogModel[Key]>>>;
};

export class CustomerCatalogService {
  constructor(private readonly model: CatalogRepository, private readonly assets: CatalogAssetsService) {}

  async templates() {
    const templates = [];
    for (const row of await this.model.templates()) {
      const meta = await this.assets.templateMetadata(row);
      templates.push({ id: row.id, name: row.name, description: row.description,
        preview_url: await this.assets.file(row.marketing_preview_path) ? `/api/templates/${row.id}/preview` : null,
        width: meta.width, height: meta.height,
        // Basic is provider-backed in the Express candidate. A face ROI is
        // required only by the retired local engine, so template availability
        // follows the managed image asset instead of legacy geometry metadata.
        basic_available: Boolean(await this.assets.file(row.image_path)),
        enabled: row.enabled, sort_order: row.sort_order });
    }
    return { templates, count: templates.length };
  }

  async templatePreview(id: string) {
    const row = await this.model.template(id);
    const path = row?.enabled ? await this.assets.file(row.marketing_preview_path) : null;
    if (!path) throw missing('template marketing preview not found');
    return path;
  }

  async experiences() {
    const experiences = [];
    for (const row of await this.model.experiences()) {
      experiences.push({ id: row.id, name: row.name, description: row.description, category: row.category,
        thumbnail: await this.assets.file(row.thumbnail_path) ? `/api/experiences/${row.id}/thumbnail` : null,
        enabled: true, sort_order: row.sort_order, availability: 'available',
        compatible_frame_style_ids: row.compatible_frame_style_ids_json ? JSON.parse(row.compatible_frame_style_ids_json) : null,
        compatible_ornament_ids: row.compatible_ornament_ids_json ? JSON.parse(row.compatible_ornament_ids_json) : null,
        max_ornaments: row.max_ornaments });
    }
    return { experiences, count: experiences.length };
  }

  async experienceThumbnail(id: string) {
    const row = await this.model.experience(id);
    const path = row?.status === 'published' ? await this.assets.file(row.thumbnail_path) : null;
    if (!path) throw missing('experience thumbnail not found');
    return path;
  }

  async layouts() {
    const layouts = [];
    for (const row of await this.model.layouts()) {
      try {
        const config = await this.assets.validateLayout(row);
        layouts.push({ id: row.id, slug: row.slug, name: row.name, canvas_width: row.canvas_width,
          canvas_height: row.canvas_height, shot_count: row.shot_count, slots: config.slots,
          preview_url: `/api/classic/layouts/${row.id}/preview`, enabled: row.active, sort_order: row.sort_order,
          theme_slug: config.theme_slug || 'classic-originals', theme_name: config.theme_name || 'Classic Originals' });
      } catch (error) { if (!(error instanceof CatalogAssetError)) throw error; }
    }
    return layouts;
  }

  async classicPreview(id: string) {
    const row = await this.model.layout(id);
    if (!row?.active) throw missing('Classic layout unavailable');
    try { return await this.assets.classicPreview(row); }
    catch (error) { if (error instanceof CatalogAssetError) throw missing('Classic frame unavailable'); throw error; }
  }

  async styles() { return (await this.model.styles()).map(({ id, slug, name, description, enabled, sort_order }) => ({ id, slug, name, description, enabled, sort_order })); }
  async ornaments() { return (await this.model.ornaments()).map(({ id, slug, name, description, enabled, sort_order }) => ({ id, slug, name, description, enabled, sort_order })); }
}

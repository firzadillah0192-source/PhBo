import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join, basename, resolve } from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import type { NxExperience, NxTemplate, NxClassicLayout } from '@prisma/client';
import type { AdminDataModel } from '../models/admin-data.model.js';
import type { AdminPrincipal } from './admin-auth.service.js';
import { CatalogAssetsService, CatalogAssetError, reviewedSlots } from './catalog-assets.service.js';
import { legacyId } from './customer-credentials.service.js';
import { AppError } from '../lib/errors.js';

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(128);
const name = z.string().min(1).max(255);
const common = { name, description: z.string().default(''), enabled: z.boolean().default(true), sort_order: z.number().int().default(0) };
const compatible = z.array(z.string()).nullable().optional();
const experienceInput = z.object({ id: slug, ...common, internal_prompt: z.string().min(1), provider: z.string().default('9router'), model: z.string().default('cx/gpt-image-2.5'), reference_mode: z.string().default('SINGLE_USER_IMAGE'), output_format: z.string().default('PNG'), status: z.enum(['draft', 'published', 'disabled']).default('draft'), category: z.string().min(1).max(64).default('Design'), compatible_frame_style_ids: compatible, compatible_ornament_ids: compatible, max_ornaments: z.number().int().min(0).max(10).default(3) }).strict();
const experiencePatch = experienceInput.omit({ id: true, provider: true, model: true, reference_mode: true, output_format: true }).partial();
const templateInput = z.object({ id: slug, ...common }).strict();
const presetInput = z.object({ id: slug, slug, ...common, prompt_fragment: z.string().min(1) }).strict();
const layoutInput = z.object({ id: slug.max(32), slug, name, canvas_width: z.number().int().positive().max(10000), canvas_height: z.number().int().positive().max(10000), shot_count: z.number().int().positive().max(20), slots: z.array(z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int(), height: z.number().int(), fit: z.literal('cover').optional() })), frame_filename: z.string().nullable().optional(), enabled: z.boolean().default(false), sort_order: z.number().int().default(0) }).strict();
const notFound = () => new AppError(404, 'CATALOG_ASSET_NOT_FOUND', 'Catalog item unavailable');

export class AdminCatalogService {
  constructor(private readonly model: AdminDataModel, readonly assets: CatalogAssetsService, readonly config: { templatesDir: string; tmpDir: string; minDimension: number; maxDimension: number }) {}
  async experienceResponse(row: NxExperience) {
    const { compatible_frame_style_ids_json, compatible_ornament_ids_json, ...data } = row;
    return { ...data, compatible_frame_style_ids: compatible_frame_style_ids_json ? JSON.parse(compatible_frame_style_ids_json) : null, compatible_ornament_ids: compatible_ornament_ids_json ? JSON.parse(compatible_ornament_ids_json) : null, preview_missing: !await this.assets.file(row.thumbnail_path) };
  }
  async templateResponse(row: NxTemplate) {
    const path = await this.assets.file(row.image_path); const preview = await this.assets.file(row.marketing_preview_path);
    const info = path ? await sharp(path).metadata().catch(() => null) : null;
    const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
    const width = info?.width ?? null, height = info?.height ?? null;
    const divisor = width && height ? gcd(width, height) : 1;
    return { ...row, preview_missing: !preview, processing_asset_present: Boolean(path), marketing_preview_url: preview ? `/api/admin/templates/${row.id}/preview` : null,
      canvas_width: width, canvas_height: height, aspect_ratio: width && height ? `${width / divisor}:${height / divisor}` : null, framed: row.id.includes('framed') };
  }
  async listExperiences() { return Promise.all((await this.model.read(db => db.nxExperience.findMany({ orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] }))).map(row => this.experienceResponse(row))); }
  async listTemplates() { return Promise.all((await this.model.read(db => db.nxTemplate.findMany({ orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] }))).map(row => this.templateResponse(row))); }
  private experienceData(input: Record<string, unknown>) {
    const { compatible_frame_style_ids, compatible_ornament_ids, ...data } = input;
    return { ...data, ...(compatible_frame_style_ids !== undefined ? { compatible_frame_style_ids_json: compatible_frame_style_ids === null ? null : JSON.stringify(compatible_frame_style_ids) } : {}), ...(compatible_ornament_ids !== undefined ? { compatible_ornament_ids_json: compatible_ornament_ids === null ? null : JSON.stringify(compatible_ornament_ids) } : {}) };
  }
  async createExperience(body: unknown, actor: AdminPrincipal) {
    const input = experienceInput.parse(body);
    const { compatible_frame_style_ids, compatible_ornament_ids, ...data } = input;
    const row = await this.model.transaction(async tx => {
      if (await tx.nxExperience.findUnique({ where: { id: input.id } })) throw new AppError(409, 'EXPERIENCE_EXISTS', 'Experience already exists.');
      const row = await tx.nxExperience.create({ data: { ...data, compatible_frame_style_ids_json: compatible_frame_style_ids == null ? null : JSON.stringify(compatible_frame_style_ids), compatible_ornament_ids_json: compatible_ornament_ids == null ? null : JSON.stringify(compatible_ornament_ids), updated_by: actor.actor_id } });
      await this.model.audit(tx, actor, 'experience_created', 'experience', row.id); return row;
    }); return this.experienceResponse(row);
  }
  async patchExperience(id: string, body: unknown, actor: AdminPrincipal) {
    const input = experiencePatch.parse(body); const changes = this.experienceData(input);
    const row = await this.model.transaction(async tx => {
      if (!await tx.nxExperience.findUnique({ where: { id } })) throw notFound();
      const row = await tx.nxExperience.update({ where: { id }, data: { ...changes, updated_by: actor.actor_id, updated_at: new Date() } });
      await this.model.audit(tx, actor, 'experience_changed', 'experience', id, '', input); return row;
    }); return this.experienceResponse(row);
  }
  async disableExperience(id: string, actor: AdminPrincipal) { await this.patchExperience(id, { status: 'disabled', enabled: false }, actor); }
  async deleteExperience(id:string,actor:AdminPrincipal){await this.model.transaction(async tx=>{await tx.nxExperience.delete({where:{id}});await this.model.audit(tx,actor,'experience_deleted','experience',id,'Admin registry deletion');});}
  async deleteTemplate(id:string,actor:AdminPrincipal){await this.model.transaction(async tx=>{await tx.nxTemplate.delete({where:{id}});await this.model.audit(tx,actor,'template_deleted','template',id,'Admin registry deletion');});}
  async createTemplate(body: unknown, actor: AdminPrincipal) {
    const input = templateInput.parse(body);
    const row = await this.model.transaction(async tx => {
      if (await tx.nxTemplate.findUnique({ where: { id: input.id } })) throw new AppError(409, 'TEMPLATE_EXISTS', 'Template already exists.');
      const row = await tx.nxTemplate.create({ data: { ...input, image_path: join(this.config.templatesDir, input.id, 'template.png'), updated_by: actor.actor_id } });
      await this.model.audit(tx, actor, 'template_created', 'template', row.id); return row;
    }); return this.templateResponse(row);
  }
  async patchTemplate(id: string, body: unknown, actor: AdminPrincipal) {
    const input = templateInput.omit({ id: true }).partial().parse(body);
    const row = await this.model.transaction(async tx => {
      if (!await tx.nxTemplate.findUnique({ where: { id } })) throw notFound();
      const row = await tx.nxTemplate.update({ where: { id }, data: { ...input, updated_at: new Date(), updated_by: actor.actor_id } });
      await this.model.audit(tx, actor, 'template_changed', 'template', id, '', input); return row;
    }); return this.templateResponse(row);
  }
  async saveImage(file: Express.Multer.File | undefined, target: string) {
    if (!file) throw new AppError(422, 'VALIDATION_FAILED', 'Image file required.');
    const image = sharp(file.buffer, { limitInputPixels: 64_000_000 });
    let info;
    try { info = await image.metadata(); await image.stats(); } catch { throw new AppError(422, 'VALIDATION_FAILED', 'Image could not be decoded.'); }
    const mimes: Record<string, string[]> = { jpeg: ['image/jpeg', 'image/jpg'], png: ['image/png'], webp: ['image/webp'] };
    if (!info.format || !mimes[info.format]?.includes(file.mimetype.toLowerCase()) || !info.width || !info.height || Math.min(info.width, info.height) < this.config.minDimension || Math.max(info.width, info.height) > this.config.maxDimension) throw new AppError(422, 'VALIDATION_FAILED', 'Image format or dimensions are invalid.');
    const bytes = await image.png().toBuffer();
    await mkdir(this.config.tmpDir, { recursive: true });
    const temporary = join(this.config.tmpDir, `${legacyId()}.png`);
    try { await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 }); await mkdir(join(target, '..'), { recursive: true }); await rename(temporary, target); }
    finally { await unlink(temporary).catch(() => {}); }
  }
  async replaceAsset(kind: 'experience' | 'template', id: string, purpose: 'image' | 'preview' | 'thumbnail', file: Express.Multer.File | undefined, actor: AdminPrincipal) {
    slug.parse(id);
    if (kind === 'experience') {
      if (!await this.model.read(db => db.nxExperience.findUnique({ where: { id } }))) throw notFound();
      const target = join(this.config.templatesDir, '_experience_thumbnails', `${id}.png`); await this.saveImage(file, target);
      const row = await this.model.transaction(async tx => { const row = await tx.nxExperience.update({ where: { id }, data: { thumbnail_path: target, preview_status: 'READY', preview_error: null, updated_at: new Date(), updated_by: actor.actor_id } }); await this.model.audit(tx, actor, 'experience_thumbnail_changed', 'experience', id); return row; });
      return this.experienceResponse(row);
    }
    if (!await this.model.read(db => db.nxTemplate.findUnique({ where: { id } }))) throw notFound();
    const target = join(this.config.templatesDir, id, purpose === 'image' ? 'template.png' : 'preview.png'); await this.saveImage(file, target);
    const row = await this.model.transaction(async tx => { const row = await tx.nxTemplate.update({ where: { id }, data: { ...(purpose === 'image' ? { image_path: target } : { marketing_preview_path: target }), updated_at: new Date(), updated_by: actor.actor_id } }); await this.model.audit(tx, actor, `template_${purpose}_changed`, 'template', id); return row; });
    return this.templateResponse(row);
  }
  async asset(kind: string, id: string, purpose: string) {
    const row = kind === 'experience' ? await this.model.read(db => db.nxExperience.findUnique({ where: { id } })) : await this.model.read(db => db.nxTemplate.findUnique({ where: { id } }));
    const path = row ? await this.assets.file(kind === 'experience' ? (row as NxExperience).thumbnail_path : purpose === 'image' ? (row as NxTemplate).image_path : (row as NxTemplate).marketing_preview_path) : null;
    if (!path) throw notFound(); return path;
  }
  async removePreview(kind: string, id: string, actor: AdminPrincipal) {
    const row = kind === 'experience' ? await this.model.read(db => db.nxExperience.findUnique({ where: { id } })) : await this.model.read(db => db.nxTemplate.findUnique({ where: { id } }));
    if (!row) throw notFound();
    const path = await this.assets.file(kind === 'experience' ? (row as NxExperience).thumbnail_path : (row as NxTemplate).marketing_preview_path);
    // Imported assets can be shared between records. Removing a preview must
    // never delete a template master or a file owned by another catalog item.
    const canonical = resolve(kind === 'experience' ? join(this.config.templatesDir, '_experience_thumbnails', `${id}.png`) : join(this.config.templatesDir, id, 'preview.png'));
    const referenced = path ? await this.model.read(async db => (await db.nxTemplate.count({ where: { OR: [{ image_path: path }, { marketing_preview_path: path, ...(kind === 'template' ? { id: { not: id } } : {}) }] } })) + (await db.nxExperience.count({ where: { thumbnail_path: path, ...(kind === 'experience' ? { id: { not: id } } : {}) } }))) : 0;
    await this.model.transaction(async tx => { if (kind === 'experience') await tx.nxExperience.update({ where: { id }, data: { thumbnail_path: null, preview_status: 'MISSING', preview_error: null } }); else await tx.nxTemplate.update({ where: { id }, data: { marketing_preview_path: null } }); await this.model.audit(tx, actor, `${kind}_preview_removed`, kind, id); });
    if (path && resolve(path) === canonical && !referenced) await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  async publishReady(actor: AdminPrincipal) {
    const ids: string[] = [];
    for (const row of await this.model.read(db => db.nxExperience.findMany({ where: { status: 'draft' } }))) if (row.preview_status === 'READY' && await this.assets.file(row.thumbnail_path)) ids.push(row.id);
    await this.model.transaction(async tx => { await tx.nxExperience.updateMany({ where: { id: { in: ids } }, data: { status: 'published', enabled: true, updated_by: actor.actor_id, updated_at: new Date() } }); await this.model.audit(tx, actor, 'experiences_published', 'experience', 'batch', '', { count: ids.length }); }); return { published: ids.length };
  }
  async layoutResponse(row: NxClassicLayout) { const config = JSON.parse(row.layout_config_json); return { id: row.id, slug: row.slug, name: row.name, canvas_width: row.canvas_width, canvas_height: row.canvas_height, shot_count: row.shot_count, slots: config.slots, enabled: row.active, sort_order: row.sort_order, preview_url: `/api/classic/layouts/${row.id}/preview`, frame_asset_present: Boolean(await this.assets.file(row.frame_asset_path)), theme_slug: config.theme_slug || 'classic-originals', theme_name: config.theme_name || 'Classic Originals' }; }
  async layouts() { return Promise.all((await this.model.read(db => db.nxClassicLayout.findMany({ orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] }))).map(row => this.layoutResponse(row))); }
  private async checkLayout(row: NxClassicLayout) { try { reviewedSlots(row); if (row.active) { if (row.canvas_width !== 1200 || row.canvas_height !== 3600) throw new Error(); await this.assets.validateLayout(row); } } catch { throw new AppError(422, 'CLASSIC_LAYOUT_INVALID', 'Classic requires reviewed slots and a valid 1200 × 3600 frame.'); } }
  async createLayout(body: unknown) {
    const { enabled, slots, frame_filename, ...input } = layoutInput.parse(body);
    if (frame_filename && (basename(frame_filename) !== frame_filename || !frame_filename.endsWith('.png'))) throw new AppError(422, 'CLASSIC_LAYOUT_INVALID', 'Frame filename must be a PNG basename');
    const row: NxClassicLayout = { ...input, active: enabled, layout_config_json: JSON.stringify({ slots }), frame_asset_path: frame_filename ? join(this.config.templatesDir, '_classic', frame_filename) : null, created_at: new Date(), updated_at: new Date() };
    await this.checkLayout(row); return this.layoutResponse(await this.model.read(db => db.nxClassicLayout.create({ data: row })));
  }
  async patchLayout(id: string, body: unknown) {
    const changes = layoutInput.omit({ id: true, slug: true, frame_filename: true }).partial().parse(body);
    const row = await this.model.read(db => db.nxClassicLayout.findUnique({ where: { id } })); if (!row) throw notFound();
    const { enabled, slots, ...data } = changes;
    const candidate = { ...row, ...data, ...(enabled === undefined ? {} : { active: enabled }), ...(slots ? { layout_config_json: JSON.stringify({ ...JSON.parse(row.layout_config_json), slots }) } : {}) };
    await this.checkLayout(candidate); return this.layoutResponse(await this.model.read(db => db.nxClassicLayout.update({ where: { id }, data: { ...candidate, updated_at: new Date() } })));
  }
  async replaceFrame(id: string, file: Express.Multer.File | undefined) {
    slug.max(32).parse(id);
    const row = await this.model.read(db => db.nxClassicLayout.findUnique({ where: { id } })); if (!row || !file) throw notFound();
    await mkdir(this.config.tmpDir, { recursive: true }); const candidate = join(this.config.tmpDir, `${legacyId()}.png`);
    const target = join(this.config.templatesDir, '_classic', `${id}.png`);
    try { await writeFile(candidate, file.buffer, { flag: 'wx' }); await this.assets.validateLayout({ ...row, frame_asset_path: candidate }); await mkdir(join(target, '..'), { recursive: true }); await rename(candidate, target); return this.layoutResponse(await this.model.read(db => db.nxClassicLayout.update({ where: { id }, data: { frame_asset_path: target } }))); }
    catch (error) { if (error instanceof CatalogAssetError) throw new AppError(422, 'CLASSIC_LAYOUT_INVALID', 'Frame image does not match the reviewed layout.'); throw error; }
    finally { await unlink(candidate).catch(() => {}); }
  }
  async presets(kind: string) { if (!['frame-styles', 'ornaments'].includes(kind)) throw notFound(); return this.model.read(db => kind === 'frame-styles' ? db.nxFrameStyle.findMany({ orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] }) : db.nxOrnament.findMany({ orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] })); }
  async savePreset(kind: string, id: string | null, body: unknown) {
    if (!['frame-styles', 'ornaments'].includes(kind)) throw notFound();
    if (id) { const input = presetInput.omit({ id: true, slug: true }).partial().parse(body); return this.model.read(db => kind === 'frame-styles' ? db.nxFrameStyle.update({ where: { id }, data: input }) : db.nxOrnament.update({ where: { id }, data: input })); }
    const input = presetInput.parse(body); return this.model.read(db => kind === 'frame-styles' ? db.nxFrameStyle.create({ data: input }) : db.nxOrnament.create({ data: input }));
  }
}

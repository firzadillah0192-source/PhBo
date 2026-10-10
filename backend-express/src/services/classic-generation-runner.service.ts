import { readFile } from 'node:fs/promises';
import type { NxGenerationJob } from '@prisma/client';
import type { CustomerGenerationModel } from '../models/customer-generation.model.js';
import type { CustomerUploadService } from './customer-upload.service.js';
import type { CatalogAssetsService } from './catalog-assets.service.js';
import type { ClassicImageEngineService } from './classic-image-engine.service.js';
import { AppError } from '../lib/errors.js';
import type { NxClassicLayout } from '@prisma/client';
import { parseGenerationSnapshot } from './generation-snapshot.js';

// This image runner is deliberately limited to Classic. It cannot dispatch to
// an AI provider or reserve credits. Full candidate worker activation is pending.
export class ClassicGenerationRunner {
  constructor(private readonly model: CustomerGenerationModel, private readonly uploads: CustomerUploadService,
    private readonly assets: CatalogAssetsService, private readonly engine: ClassicImageEngineService) {}
  async generate(job: NxGenerationJob) {
    if (job.mode !== 'CLASSIC') throw new AppError(503, 'GENERATION_ENGINE_NOT_CONNECTED', 'Generation engine is not connected.');
    const snapshot = parseGenerationSnapshot(job.engine_config_json,job.mode);
    const layout = snapshot?.mode==='CLASSIC' ? snapshot.layout as NxClassicLayout : job.layout_id ? await this.model.layout(job.layout_id) : null;
    if (!layout?.active) throw new AppError(422, 'CLASSIC_LAYOUT_INVALID', 'Classic layout unavailable');
    await this.assets.validateLayout(layout);
    const ids = JSON.parse(job.capture_upload_ids_json ?? '[]') as string[];
    if (!Array.isArray(ids) || ids.length !== layout.shot_count || new Set(ids).size !== layout.shot_count || ids[0] !== job.upload_id) throw new AppError(422, 'CLASSIC_SHOT_COUNT_INVALID', 'Incorrect number of captures');
    const owner = { account: job.account_id ? { id: job.account_id } : null, guest: job.guest_id ? { id: job.guest_id } : null };
    const photos = [];
    for (const id of ids) photos.push(await this.uploads.read((await this.uploads.owned(id, owner)).path));
    const frame = await this.assets.file(layout.frame_asset_path);
    if (!frame) throw new AppError(422, 'CLASSIC_LAYOUT_INVALID', 'Classic frame unavailable');
    return this.engine.generate(layout, photos, await readFile(frame), snapshot?.mode === 'CLASSIC' ? snapshot.personalization : undefined);
  }
}

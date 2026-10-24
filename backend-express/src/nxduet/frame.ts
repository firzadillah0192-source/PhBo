import { readFile } from 'node:fs/promises';
import type { NxClassicLayout } from '@prisma/client';
import type { CustomerGenerationModel } from '../models/customer-generation.model.js';
import type { CatalogAssetsService } from '../services/catalog-assets.service.js';
import { reviewedSlots,type ClassicSlot } from '../services/catalog-assets.service.js';
import type { ClassicImageEngineService } from '../services/classic-image-engine.service.js';
import { AppError } from '../lib/errors.js';
import { FRAME_LAYOUT_ID,POSE_COUNT } from './policy.js';

export type DuetFrameInfo={layout:NxClassicLayout;slots:ClassicSlot[];frame:Buffer};
// NXDuet strips reuse the admin-managed Classic frame and the Classic compositor.
export class DuetFrame {
  constructor(private readonly model:Pick<CustomerGenerationModel,'layout'>,private readonly assets:Pick<CatalogAssetsService,'validateLayout'|'file'>,private readonly engine:Pick<ClassicImageEngineService,'generate'>,private readonly layoutId=FRAME_LAYOUT_ID){}
  private unavailable(){return new AppError(503,'NXDUET_FRAME_UNAVAILABLE','Frame strip NXDuet belum tersedia.');}
  async info(){
    const layout=await this.model.layout(this.layoutId);
    if(!layout?.active||layout.shot_count!==POSE_COUNT||!layout.frame_asset_path)throw this.unavailable();
    let slots:ClassicSlot[];try{slots=reviewedSlots(layout).slots;await this.assets.validateLayout(layout);}catch{throw this.unavailable();}
    return {layout,slots};
  }
  async load():Promise<DuetFrameInfo>{
    const {layout,slots}=await this.info();
    const path=await this.assets.file(layout.frame_asset_path);if(!path)throw this.unavailable();
    return {layout,slots,frame:await readFile(path)};
  }
  async compose(info:DuetFrameInfo,photos:Buffer[]){return (await this.engine.generate(info.layout,photos,info.frame)).bytes;}
}

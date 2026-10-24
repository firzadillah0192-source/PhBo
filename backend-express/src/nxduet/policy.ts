import { z } from 'zod';
import sharp from 'sharp';
import { AppError } from '../lib/errors.js';

export const PREPARATION_CREDITS = 100;
export const MAX_ASSET_BYTES = 25 * 1024 * 1024;
export const idSchema = z.string().regex(/^[a-f0-9]{32}$/);
export const placementSchema = z.object({ side: z.enum(['left','right']), scale: z.number().min(0.4).max(1) }).strict();
export const createSchema = z.object({ upload_id: idSchema, name: z.string().trim().min(1).max(80), rights_accepted: z.literal(true) }).strict();
export const patchSchema = z.object({ name: z.string().trim().min(1).max(80).optional(), placement: placementSchema.optional() }).strict().refine(v=>v.name!==undefined||v.placement!==undefined);
export const PREPARATION_PROMPT = `Prepare the supplied photo as a single static companion cutout for a live camera photobooth. Preserve the exact subject identity, facial features, clothing, pose, proportions and photographic or illustration style. Remove the background completely. Return a genuine transparent RGBA PNG, with clean hair and clothing edges. Keep the visible subject entirely within the canvas with transparent margins. Do not invent missing limbs, change the pose, add people, scenery, shadows outside the subject, glow, text, frame or watermark. Transparency must be actual alpha, not a white, black or checkerboard background.`;

export async function validateOverlay(bytes: Buffer) {
  if (!bytes.length || bytes.length>MAX_ASSET_BYTES) throw new AppError(502,'NXDUET_OVERLAY_INVALID','Hasil penyiapan tidak dapat digunakan. Kredit dikembalikan.');
  try {
    const image=sharp(bytes,{limitInputPixels:16_000_000}),meta=await image.metadata();
    if(meta.format!=='png'||!meta.hasAlpha||!meta.width||!meta.height||Math.min(meta.width,meta.height)<256||Math.max(meta.width,meta.height)>4096)throw new Error();
    const {data,info}=await image.ensureAlpha().raw().toBuffer({resolveWithObject:true});
    let clear=0,solid=0,border=0,borderClear=0;
    for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
      const alpha=data[(y*info.width+x)*info.channels+info.channels-1];
      if(alpha<=8)clear++;if(alpha>=240)solid++;
      if(x===0||y===0||x===info.width-1||y===info.height-1){border++;if(alpha<=8)borderClear++;}
    }
    const pixels=info.width*info.height;
    if(clear/pixels<0.08||solid/pixels<0.05||borderClear/border<0.7)throw new Error();
    return {width:meta.width,height:meta.height};
  } catch { throw new AppError(502,'NXDUET_OVERLAY_INVALID','Hasil belum memiliki potongan transparan yang layak. Kredit dikembalikan.'); }
}

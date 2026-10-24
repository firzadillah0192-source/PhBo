import sharp from 'sharp';
import { AppError } from '../lib/errors.js';
import { POSE_COUNT,placementSchema } from './policy.js';
import type { DuetFrame,DuetFrameInfo } from './frame.js';

// The companion always stands on the left and is bottom-aligned, sized from the slot.
export function companionRect(width:number,height:number,imageWidth:number,imageHeight:number,placement:{side:'left';scale:number}){
  const ratio=Math.min(width*0.5/imageWidth,height/imageHeight)*placement.scale;
  const w=Math.max(1,Math.round(imageWidth*ratio)),h=Math.max(1,Math.round(imageHeight*ratio));
  return {width:w,height:h,left:0,top:height-h};
}
// Each capture k gets pose k, then the three composites are placed into the Classic frame slots.
export async function composeDuet(captures:Express.Multer.File[],overlays:Buffer[],rawPlacement:unknown,frame:DuetFrame,info:DuetFrameInfo){
  const placement=placementSchema.parse(rawPlacement);
  if(captures.length!==POSE_COUNT||overlays.length!==POSE_COUNT)throw new AppError(422,'NXDUET_CAPTURE_COUNT','Ambil tepat tiga foto.');
  const photos:Buffer[]=[];
  for(const [index,file] of captures.entries()){
    if(!['image/jpeg','image/png','image/webp'].includes(file.mimetype)||!(/\.(jpe?g|png|webp)$/i.test(file.originalname)))throw new AppError(422,'VALIDATION_FAILED','Format foto tidak didukung.');
    const slot=info.slots[index]!;
    let camera:Buffer;
    try{
      const image=sharp(file.buffer,{limitInputPixels:16_000_000,failOn:'warning'}),meta=await image.metadata();
      if(!meta.width||!meta.height||meta.width<256||meta.height<256||!['jpeg','png','webp'].includes(meta.format??''))throw new Error();
      camera=await image.rotate().resize(slot.width,slot.height,{fit:'cover'}).removeAlpha().png().toBuffer();
    }catch{throw new AppError(422,'VALIDATION_FAILED','Foto tidak dapat dibaca atau dimensinya tidak sesuai.');}
    const overlay=overlays[index]!,size=await sharp(overlay,{limitInputPixels:16_000_000}).metadata();
    if(!size.width||!size.height)throw new AppError(502,'NXDUET_OVERLAY_INVALID','Template tidak dapat dibaca.');
    const rect=companionRect(slot.width,slot.height,size.width,size.height,placement);
    const companion=await sharp(overlay).resize(rect.width,rect.height).png().toBuffer();
    photos.push(await sharp(camera).composite([{input:companion,left:rect.left,top:rect.top}]).jpeg({quality:95}).toBuffer());
  }
  return frame.compose(info,photos);
}

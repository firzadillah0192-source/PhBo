import sharp from 'sharp';
import { AppError } from '../lib/errors.js';
import { placementSchema } from './policy.js';

export function companionRect(width:number,height:number,imageWidth:number,imageHeight:number,placement:{side:'left'|'right';scale:number}){
  const ratio=Math.min(width*0.5/imageWidth,height/imageHeight)*placement.scale;
  const w=Math.max(1,Math.round(imageWidth*ratio)),h=Math.max(1,Math.round(imageHeight*ratio));
  return {width:w,height:h,left:placement.side==='right'?width-w:0,top:height-h};
}
export async function composeDuet(captures:Express.Multer.File[],overlay:Buffer,rawPlacement:unknown){
  const placement=placementSchema.parse(rawPlacement);
  if(captures.length!==3)throw new AppError(422,'NXDUET_CAPTURE_COUNT','Ambil tepat tiga foto.');
  const width=1200,photoHeight=900,padding=50,gap=30,header=110,footer=130;
  const meta=await sharp(overlay,{limitInputPixels:16_000_000}).metadata();
  if(!meta.width||!meta.height)throw new AppError(502,'NXDUET_OVERLAY_INVALID','Template tidak dapat dibaca.');
  const rect=companionRect(width,photoHeight,meta.width,meta.height,placement);
  const companion=await sharp(overlay).resize(rect.width,rect.height).png().toBuffer();
  const photos:Buffer[]=[];
  for(const file of captures){
    if(!['image/jpeg','image/png','image/webp'].includes(file.mimetype)||!(/\.(jpe?g|png|webp)$/i.test(file.originalname)))throw new AppError(422,'VALIDATION_FAILED','Format foto tidak didukung.');
    try{
      const image=sharp(file.buffer,{limitInputPixels:16_000_000,failOn:'warning'}),info=await image.metadata();
      if(!info.width||!info.height||info.width<256||info.height<256||!['jpeg','png','webp'].includes(info.format??''))throw new Error();
      const camera=await image.rotate().resize(width,photoHeight,{fit:'cover'}).removeAlpha().png().toBuffer();
      photos.push(await sharp(camera).composite([{input:companion,left:rect.left,top:rect.top}]).png().toBuffer());
    }catch{throw new AppError(422,'VALIDATION_FAILED','Foto tidak dapat dibaca atau dimensinya tidak sesuai.');}
  }
  const height=header+3*photoHeight+2*gap+footer,canvasWidth=width+2*padding;
  // Fixed server-owned lettering; no user text is interpolated into SVG.
  const lettering=Buffer.from(`<svg width="${canvasWidth}" height="${height}"><text x="${canvasWidth/2}" y="72" text-anchor="middle" font-family="sans-serif" font-size="42" fill="#ffffff">NXDuet</text><text x="${canvasWidth/2}" y="${height-55}" text-anchor="middle" font-family="sans-serif" font-size="26" fill="#d8d2ef">Beda dunia, satu frame.</text></svg>`);
  return sharp({create:{width:canvasWidth,height,channels:4,background:'#181422'}}).composite([...photos.map((input,i)=>({input,left:padding,top:header+i*(photoHeight+gap)})),{input:lettering,left:0,top:0}]).png().toBuffer();
}

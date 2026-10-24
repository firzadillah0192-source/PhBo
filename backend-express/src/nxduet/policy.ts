import { z } from 'zod';
import sharp from 'sharp';
import { AppError } from '../lib/errors.js';

export const PREPARATION_CREDITS = 100;
export const MAX_ASSET_BYTES = 25 * 1024 * 1024;
export const idSchema = z.string().regex(/^[a-f0-9]{32}$/);
export const placementSchema = z.object({ side: z.literal('left'), scale: z.number().min(0.4).max(1) }).strict();
export const patchSchema = z.object({ name: z.string().trim().min(1).max(80).optional(), placement: placementSchema.optional() }).strict().refine(v=>v.name!==undefined||v.placement!==undefined);
export const FRAME_LAYOUT_ID = 'classic-frame-003';
export const POSE_COUNT = 3;
// Server-owned. Customers choose keys only; instructions and prompts never leave the server.
export const POSES = [
  { key: 'smile', label: 'Tersenyum', instruction: 'a warm, natural smile with relaxed shoulders, looking toward the camera' },
  { key: 'laugh', label: 'Tertawa', instruction: 'laughing happily with an open smile and bright, joyful eyes' },
  { key: 'angry', label: 'Marah', instruction: 'a playful angry expression with furrowed brows and a stern look, arms crossed or fists lightly clenched' },
  { key: 'surprised', label: 'Kaget', instruction: 'a surprised expression with wide eyes and an open mouth, hands raised near the face' },
  { key: 'pout', label: 'Cemberut', instruction: 'a cute pout with slightly puffed cheeks and a sulky look' },
  { key: 'hug', label: 'Peluk', instruction: 'a warm embracing pose: body turned slightly toward the subject\'s right, both arms open and reaching forward as if hugging a person standing beside them, with a gentle smile. The arms reach toward empty space; do not draw the other person' },
  { key: 'wave', label: 'Melambai', instruction: 'one hand raised in a friendly wave with a cheerful smile' },
  { key: 'peace', label: 'Salam dua jari', instruction: 'a smile with one hand making a peace (V) sign near the face' },
  { key: 'heart', label: 'Bentuk hati', instruction: 'both hands forming a heart shape in front of the chest with a sweet smile' },
  { key: 'thumbs', label: 'Jempol', instruction: 'a confident smile with one thumb raised in approval' },
] as const;
export type PoseKey = typeof POSES[number]['key'];
export const POSE_KEYS = POSES.map(pose => pose.key) as [PoseKey, ...PoseKey[]];
export const poseSchema = z.enum(POSE_KEYS);
export const LEGACY_POSE_KEY = 'original';
export const poseLabel = (key: string) => POSES.find(pose => pose.key === key)?.label ?? 'Pose asli';
export const posesSchema = z.array(poseSchema).length(POSE_COUNT).refine(list => new Set(list).size === list.length, 'Pilih tiga pose yang berbeda.');
export const createSchema = z.object({ upload_id: idSchema, name: z.string().trim().min(1).max(80), poses: posesSchema, rights_accepted: z.literal(true) }).strict();
const POSE_BASE = `Prepare the supplied photo as a single static companion cutout for a live camera photobooth. Preserve the exact subject identity, facial features, hairstyle, clothing, body proportions and photographic or illustration style. Frame the subject as a three-quarter body portrait from the top of the head down to the mid-thigh, even when the supplied photo shows the full body from head to feet; the cut at the bottom edge of the canvas is intentional. Keep the head and both sides inside the canvas with small transparent margins. Change only the pose and expression as described below. Remove the background completely. Return a genuine transparent RGBA PNG, with clean hair and clothing edges. Do not add other people, scenery, shadows outside the subject, glow, text, frame or watermark. Transparency must be actual alpha, not a white, black or checkerboard background.`;
export function posePrompt(key: string) {
  const pose = POSES.find(item => item.key === key);
  if (!pose) throw new AppError(422, 'NXDUET_POSE_INVALID', 'Pose tidak dikenal.');
  return `${POSE_BASE}\nPose and expression: ${pose.instruction}.`;
}

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

// Crop to the visible subject: small margins above and beside, flush at the bottom so a
// three-quarter-body figure stands on the bottom edge of the photo slot.
export async function cropCutout(bytes: Buffer) {
  try {
    const { data, info } = await sharp(bytes, { limitInputPixels: 16_000_000 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let top = info.height, left = info.width, right = -1, bottom = -1;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * info.channels + info.channels - 1]! <= 8) continue;
      if (y < top) top = y; if (y > bottom) bottom = y; if (x < left) left = x; if (x > right) right = x;
    }
    if (right < 0) throw new Error();
    const pad = Math.round(Math.max(right - left, bottom - top) * 0.02);
    const x0 = Math.max(0, left - pad), y0 = Math.max(0, top - pad), x1 = Math.min(info.width, right + 1 + pad);
    const output = await sharp(bytes).extract({ left: x0, top: y0, width: x1 - x0, height: bottom + 1 - y0 }).png().toBuffer();
    const meta = await sharp(output).metadata();
    if (!meta.width || !meta.height || meta.width < 128 || meta.height < 256) throw new Error();
    return { bytes: output, width: meta.width, height: meta.height };
  } catch { throw new AppError(502, 'NXDUET_OVERLAY_INVALID', 'Hasil belum memiliki potongan transparan yang layak. Kredit dikembalikan.'); }
}

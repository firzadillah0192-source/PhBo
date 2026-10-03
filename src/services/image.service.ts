import type { UploadedImage } from '../types/domain.js';
import sharp from 'sharp';
import { AppError, ensure } from '../lib/errors.js';

const options = { limitInputPixels: 25000000, failOn: 'warning' as const };
export class ImageService {
  async normalize(file: UploadedImage | undefined, isFrame = false) {
    ensure(file?.buffer, 400, 'IMAGE_REQUIRED', 'Provide an image in multipart field image');
    try {
      const metadata = await sharp(file.buffer, options).metadata();
      ensure(['jpeg', 'png', 'webp', 'jpg'].includes(metadata.format) && (metadata.pages ?? 1) === 1, 415, 'IMAGE_FORMAT', 'Only static JPEG, PNG, or WebP images are supported');
      if (isFrame) ensure(metadata.hasAlpha, 400, 'FRAME_ALPHA', 'Frame must have an alpha channel for transparent photo areas');
      const { data, info } = await sharp(file.buffer, options).rotate().png().toBuffer({ resolveWithObject: true });
      return { buffer: data, mimeType: 'image/png', width: info.width, height: info.height };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(400, 'INVALID_IMAGE', 'Image is invalid or exceeds 25 megapixels');
    }
  }
  async render(original: Buffer, frame: Buffer | null) {
    if (!frame) return sharp(original, options).png().toBuffer();
    const { width, height } = await sharp(frame, options).metadata();
    return sharp(original, options).resize(width, height, { fit: 'cover' }).composite([{ input: frame }]).png().toBuffer();
  }
}

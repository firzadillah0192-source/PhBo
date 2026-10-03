import multer from 'multer';
import { AppError } from '../lib/errors.js';

const uploader = (maxMb: number, files: number) => multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxMb * 1024 * 1024, files, fields: 5, parts: files + 5 },
  fileFilter: (_req, file, done) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) return done(new AppError(415, 'IMAGE_FORMAT', 'Only JPEG, PNG, or WebP are supported'));
    done(null, true);
  },
});
export const imageUpload = (maxMb: number) => uploader(maxMb, 1).single('image');
export const photoUpload = (maxMb: number) => uploader(maxMb, 4).array('image', 4);

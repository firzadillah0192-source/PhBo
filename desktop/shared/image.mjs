import { createHash } from 'node:crypto';
export function inspectImage(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 9 || bytes.length > 16 * 1024 * 1024) throw new Error('INVALID_IMAGE');
  const mime = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg' : null;
  if (!mime) throw new Error('INVALID_IMAGE');
  return { mime, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
}

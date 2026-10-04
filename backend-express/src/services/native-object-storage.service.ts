import type { Client } from 'minio';
export type NativeObjectSigning = { client: Pick<Client,'presignedGetObject'>; origin: string; ttlSeconds: number };

// Store explicit, scoped references in the existing storage_path column.
// Never interpret arbitrary database paths as MinIO keys.
export class NativeObjectStorage {
  constructor(private readonly client: Pick<Client, 'putObject' | 'getObject' | 'statObject' | 'removeObject' | 'bucketExists'>, readonly bucket: string, private readonly signing?: NativeObjectSigning) {}
  private key(reference: string) {
    if (reference.startsWith('minio://catalog/')) {
      const key = reference.slice('minio://'.length);
      const parts = key.slice('catalog/'.length).split('/');
      if (!parts.length || parts.length > 12 || parts.some(part => !/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,254}$/.test(part) || part === '..' || part === '.')) throw new Error('Invalid catalog object reference');
      return key;
    }
    const event = /^minio:\/\/(uploads|results)\/events\/([A-Za-z0-9][A-Za-z0-9_-]{0,119})\/(images|results)\/([a-f0-9]{32})\.(jpg|png)$/.exec(reference);
    if (event && event[1] === (event[3] === 'images' ? 'uploads' : 'results') &&
      event[5] === (event[1] === 'uploads' ? 'jpg' : 'png')) return reference.slice('minio://'.length);
    const match = /^minio:\/\/(uploads|results)\/([a-f0-9]{2})\/([a-f0-9]{32})\.(jpg|png)$/.exec(reference);
    if (!match || match[2] !== match[3].slice(0, 2) || match[4] !== (match[1] === 'uploads' ? 'jpg' : 'png')) throw new Error('Invalid object reference');
    return reference.slice('minio://'.length);
  }
  catalogReference(relativePath: string) {
    const ref = `minio://catalog/${relativePath}`;
    this.key(ref);
    return ref;
  }
  async info(reference: string) {
    const key = this.key(reference);
    try { return await this.client.statObject(this.bucket, key); }
    catch (error) {
      if (error && typeof error === 'object' && 'code' in error && ['NoSuchKey', 'NotFound', 'NoSuchObject'].includes(String(error.code))) return null;
      throw new Error('Object storage unavailable');
    }
  }
  reference(kind: 'uploads' | 'results', id: string,eventSlug?: string) {
    const extension = kind === 'uploads' ? 'jpg' : 'png';
    if (eventSlug!==undefined&&!/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(eventSlug)) throw new Error('Invalid event object namespace');
    const reference = eventSlug
      ? `minio://${kind}/events/${eventSlug}/${kind === 'uploads' ? 'images' : 'results'}/${id}.${extension}`
      : `minio://${kind}/${id.slice(0,2)}/${id}.${extension}`;
    this.key(reference);
    return reference;
  }
  matchesReference(kind: 'uploads' | 'results',id: string,reference: string) {
    try {
      const key=this.key(reference),extension=kind==='uploads'?'jpg':'png';
      return key.startsWith(`${kind}/`) && key.endsWith(`/${id}.${extension}`);
    } catch { return false; }
  }
  async put(reference: string, bytes: Buffer, contentType: string, sourceMtime = Date.now()) {
    await this.client.putObject(this.bucket, this.key(reference), bytes, bytes.length, { 'Content-Type': contentType, 'X-Amz-Meta-Nxbooth-Source-Mtime': String(sourceMtime) });
  }
  async read(reference: string) {
    const stream = await this.client.getObject(this.bucket, this.key(reference));
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += bytes.length;
      if (length > 25 * 1024 * 1024) { stream.destroy(); throw new Error('Object exceeds image size limit'); }
      chunks.push(bytes);
    }
    return Buffer.concat(chunks);
  }
  async exists(reference: string) {
    return Boolean(await this.info(reference));
  }
  async signedUrl(reference: string,notAfter?: Date) {
    const key = this.key(reference);
    // Catalog metadata/JSON is not a customer photo and must never be signed.
    if (!/^(uploads|results)\//.test(key)) throw new Error('Only customer images support signed delivery');
    if (!this.signing) return null;
    const remaining = notAfter ? Math.floor((notAfter.getTime()-Date.now())/1000) : this.signing.ttlSeconds;
    const ttl = Math.min(remaining,this.signing.ttlSeconds);
    if (!Number.isFinite(ttl) || ttl<1) return null;
    try {
      const url = await this.signing.client.presignedGetObject(this.bucket,key,ttl,{ 'response-cache-control': 'private, no-store' });
      const parsed = new URL(url);
      if (parsed.origin!==this.signing.origin || parsed.username || parsed.password) throw new Error();
      return { url,expires_at: new Date(Date.now()+ttl*1000) };
    } catch { throw new Error('Signed image delivery unavailable'); }
  }
  async remove(reference: string) { await this.client.removeObject(this.bucket, this.key(reference)); }
  async health() { if (!await this.client.bucketExists(this.bucket)) throw new Error('Storage bucket unavailable'); }
}

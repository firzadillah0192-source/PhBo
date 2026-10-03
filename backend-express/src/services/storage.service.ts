import type { Client } from 'minio';
import type { StorageConfig } from '../config/env.js';
import { errorMessage } from '../lib/errors.js';
import { randomUUID } from 'node:crypto';
import { eventSlug } from '../objects/requests.js';

export class StorageService {
  constructor(
    private readonly client: Pick<Client, 'putObject' | 'getObject' | 'removeObject'>,
    private readonly publicClient: Pick<Client, 'presignedGetObject'>,
    private readonly config: StorageConfig,
  ) {}
  async put(buffer: Buffer, mimeType: string, folder: 'images' | 'frames' = 'images', event?: string): Promise<string> {
    const prefix = event === undefined ? folder : `${eventSlug.parse(event)}/${folder}`;
    const objectId = `${prefix}/${randomUUID()}`;
    // Persist the complete key; reads must never reconstruct it from current settings.
    await this.client.putObject(this.config.MINIO_BUCKET, objectId, buffer, buffer.length, { 'Content-Type': mimeType });
    return objectId;
  }
  async read(objectId: string): Promise<Buffer> {
    const stream = await this.client.getObject(this.config.MINIO_BUCKET, objectId);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
  }
  remove(objectId: string) { return this.client.removeObject(this.config.MINIO_BUCKET, objectId); }
  url(objectId: string, expiresAt?: Date) {
    const remaining = expiresAt ? Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000) : this.config.PRESIGNED_URL_TTL_SECONDS;
    if (remaining < 1) return null;
    return this.publicClient.presignedGetObject(this.config.MINIO_BUCKET, objectId, Math.min(remaining, this.config.PRESIGNED_URL_TTL_SECONDS));
  }
  async cleanup(objectId: string) {
    try { await this.remove(objectId); }
    catch (error) { console.error('Object cleanup failed', objectId, errorMessage(error)); }
  }
}

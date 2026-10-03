import type { Frame } from '@prisma/client';
import type { FrameModel } from '../models/frame.model.js';
import type { CreateFrameInput, UpdateFrameInput } from '../objects/requests.js';
import type { Repository, UploadedImage } from '../types/domain.js';
import type { StorageService } from './storage.service.js';
import type { ImageService } from './image.service.js';
import { ensure } from '../lib/errors.js';
import { frameObject } from '../objects/responses.js';

export class FrameService {
  constructor(
    private readonly model: Repository<FrameModel>,
    private readonly storage: Pick<StorageService, 'put' | 'url' | 'cleanup'>,
    private readonly images: Pick<ImageService, 'normalize'>,
  ) {}
  async present(frame: Frame) { return frameObject(frame, await this.storage.url(frame.objectId)); }
  async list() { return Promise.all((await this.model.list()).map((frame) => this.present(frame))); }
  async get(id: string) {
    const frame = await this.model.find(id);
    ensure(frame?.active, 404, 'FRAME_NOT_FOUND', 'Frame not found');
    return this.present(frame);
  }
  async create(input: CreateFrameInput, file: UploadedImage | undefined) {
    const image = await this.images.normalize(file, true);
    const objectId = await this.storage.put(image.buffer, image.mimeType, 'frames', input.event);
    let frame;
    try { frame = await this.model.create({ name: input.name, objectId, width: image.width, height: image.height }); }
    catch (error) { await this.storage.cleanup(objectId); throw error; }
    return this.present(frame);
  }
  async update(id: string, input: UpdateFrameInput) {
    ensure(await this.model.find(id), 404, 'FRAME_NOT_FOUND', 'Frame not found');
    return this.present(await this.model.update(id, input));
  }
  async disable(id: string) {
    ensure(await this.model.find(id), 404, 'FRAME_NOT_FOUND', 'Frame not found');
    await this.model.update(id, { active: false });
  }
}

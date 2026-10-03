import type { GenerationModel } from '../models/generation.model.js';
import type { Repository, WorkerJob } from '../types/domain.js';
import type { StorageService } from './storage.service.js';
import type { ImageService } from './image.service.js';
import { errorMessage } from '../lib/errors.js';
import type { GenerationEngineService } from './generation-engine.service.js';
export class GenerationWorkerService {
  constructor(
    private readonly model: Repository<Pick<GenerationModel, 'complete' | 'fail'>>,
    private readonly storage: Pick<StorageService, 'read' | 'put' | 'cleanup'>,
    private readonly images: Pick<ImageService, 'render' | 'normalize'>,
    private readonly ai?: Pick<GenerationEngineService, 'generate'>,
  ) {}
  async process(job: WorkerJob) {
    let objectId;
    let completionStarted = false;
    try {
      if (job.session.expiresAt <= new Date()) throw new Error('Session expired');
      if (!job.session.photo) throw new Error('Session photo missing');
      const original = await this.storage.read(job.session.photo.objectId);
      const available = job.session.photos ?? [job.session.photo];
      const ids = job.photoIds?.length ? job.photoIds : [job.session.photo.id];
      const selected = ids.map(id => {
        const photo = available.find(item => item.id === id);
        if (!photo) throw new Error('Selected photo does not belong to session');
        return photo;
      });
      let result: Buffer;
      if (job.mode === 'BASIC' || job.mode === 'ADVANCED' || job.mode === 'CLASSIC') {
        if (!this.ai) throw new Error('AI engine is not configured');
        const photos = await Promise.all(selected.map(photo => photo.objectId === job.session.photo!.objectId ? original : this.storage.read(photo.objectId)));
        const classic = job.mode === 'CLASSIC' ? { photos, frame: job.frame ? await this.storage.read(job.frame.objectId) : null } : undefined;
        const generated = await this.ai.generate(photos[0], job.mode, job.id, job.engineConfig, classic);
        result = (await this.images.normalize({ buffer: generated })).buffer;
      } else {
        // ORIGINAL is supported only to drain historical jobs after migration.
        result = await this.images.render(original, null);
      }
      const photoKeyParts = job.session.photo.objectId.split('/');
      const event = photoKeyParts.length === 3 ? photoKeyParts[0] : undefined;
      objectId = await this.storage.put(result, 'image/png', 'images', event);
      completionStarted = true;
      const completed = await this.model.complete(job, objectId);
      if (!completed.count) await this.storage.cleanup(objectId);
      else console.log('Generation completed:', job.id);
    } catch (error) {
      // A DB timeout can have committed: don't delete the object or mark failed
      // after an ambiguous completion. Lease recovery will reconcile the job.
      if (completionStarted) { console.error('Generation completion uncertain:', job.id, errorMessage(error)); return; }
      if (objectId) await this.storage.cleanup(objectId);
      console.error('Generation failed:', job.id, errorMessage(error));
      await this.model.fail(job, 'Generation failed; please try again');
    }
  }
}

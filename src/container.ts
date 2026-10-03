import { db, minio, publicMinio } from './config/clients.js';
import { env } from './config/env.js';
import { FrameModel } from './models/frame.model.js';
import { PhotoSessionModel } from './models/photo-session.model.js';
import { PhotoModel } from './models/photo.model.js';
import { GenerationModel } from './models/generation.model.js';
import { StorageService } from './services/storage.service.js';
import { ImageService } from './services/image.service.js';
import { BrowserSessionService } from './services/browser-session.service.js';
import { FrameService } from './services/frame.service.js';
import { PhotoSessionService } from './services/photo-session.service.js';
import { PhotoService } from './services/photo.service.js';
import { GenerationService } from './services/generation.service.js';
import { AiEngineService } from './services/ai-engine.service.js';
import { NineRouterService } from './services/ninerouter.service.js';
import { GenerationEngineService } from './services/generation-engine.service.js';

export const storage = new StorageService(minio, publicMinio, env);
export const images = new ImageService();
export const ai = new GenerationEngineService(new AiEngineService(env), new NineRouterService(env), env);
export const generationModel = new GenerationModel(db);
const frameModel = new FrameModel(db);
const sessionModel = new PhotoSessionModel(db);
const browsers = new BrowserSessionService(sessionModel);
const sessions = new PhotoSessionService(sessionModel, storage, images, browsers, env);
export const services = {
  browsers, sessions,
  frames: new FrameService(frameModel, storage, images),
  photos: new PhotoService(new PhotoModel(db), storage),
  generations: new GenerationService(generationModel, frameModel, sessions, storage, ai),
};

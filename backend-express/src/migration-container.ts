import type { PrismaClient } from '@prisma/client';
import type { z } from 'zod';
import { join } from 'node:path';
import { Client } from 'minio';
import { NativeObjectStorage } from './services/native-object-storage.service.js';
import type { migrationConfigSchema } from './config/migration-env.js';
import { CustomerCatalogModel } from './models/customer-catalog.model.js';
import { CustomerCatalogService } from './services/customer-catalog.service.js';
import { CatalogAssetsService } from './services/catalog-assets.service.js';
import { CustomerAccountModel } from './models/customer-account.model.js';
import { CustomerAccountService } from './services/customer-account.service.js';
import { GoogleIdentityService } from './services/google-identity.service.js';
import { CustomerResultModel } from './models/customer-result.model.js';
import { CustomerResultService } from './services/customer-result.service.js';
import { CustomerUploadModel } from './models/customer-upload.model.js';
import { CustomerUploadService } from './services/customer-upload.service.js';
import { UploadImageEngineService } from './services/upload-image-engine.service.js';
import { CustomerGenerationModel } from './models/customer-generation.model.js';
import { CustomerGenerationService } from './services/customer-generation.service.js';
import { RedisGenerationQueue } from './services/redis-generation-queue.service.js';
import { NativeNineRouterProvider, NativeNullProvider } from './services/native-provider.service.js';
import { NativeImageEngineService } from './services/native-image-engine.service.js';
import { ClassicImageEngineService } from './services/classic-image-engine.service.js';
import { ClassicGenerationRunner } from './services/classic-generation-runner.service.js';
import { NativeGenerationRunner } from './services/native-generation-runner.service.js';
import { ProviderRunModel } from './models/provider-run.model.js';
import { CustomerGenerationWorkerService } from './services/customer-generation-worker.service.js';
import { AdminAuthModel } from './models/admin-auth.model.js';
import { AdminDataModel } from './models/admin-data.model.js';
import { AdminAuthService } from './services/admin-auth.service.js';
import { AdminCatalogService } from './services/admin-catalog.service.js';
import { AdminOperationsService } from './services/admin-operations.service.js';
import { AdminUsageService } from './services/admin-usage.service.js';
import { AdminPreviewService } from './services/admin-preview.service.js';
import { NativeRateLimitService } from './services/native-rate-limit.service.js';
import { NativeKioskModel } from './models/native-kiosk.model.js';
import { NativeKioskService } from './services/native-kiosk.service.js';
import { nativeGenerationQueue } from './services/native-generation-queue.js';

export function migrationContainer(db:PrismaClient,config:z.output<typeof migrationConfigSchema>){
  const publicClient = config.MINIO_SIGNED_URLS_ENABLED ? new Client({ endPoint: config.MINIO_PUBLIC_ENDPOINT,port: config.MINIO_PUBLIC_PORT,
    useSSL: config.MINIO_PUBLIC_USE_SSL,accessKey: config.MINIO_ACCESS_KEY,secretKey: config.MINIO_SECRET_KEY,region: config.MINIO_REGION }) : undefined;
  const publicOrigin = `${config.MINIO_PUBLIC_USE_SSL?'https':'http'}://${config.MINIO_PUBLIC_ENDPOINT}${config.MINIO_PUBLIC_PORT===(config.MINIO_PUBLIC_USE_SSL?443:80)?'':`:${config.MINIO_PUBLIC_PORT}`}`;
  const objects = config.STORAGE_BACKEND === 'minio' ? new NativeObjectStorage(new Client({ endPoint: config.MINIO_ENDPOINT, port: config.MINIO_PORT, useSSL: config.MINIO_USE_SSL, accessKey: config.MINIO_ACCESS_KEY, secretKey: config.MINIO_SECRET_KEY, region: config.MINIO_REGION }), config.MINIO_BUCKET,
    publicClient ? { client: publicClient,origin: publicOrigin,ttlSeconds: config.MINIO_PRESIGNED_URL_TTL_SECONDS } : undefined) : undefined;
  const storageReady = async () => { await objects?.health(); };
  const queue=nativeGenerationQueue(db,config,'customer'),previewQueue=nativeGenerationQueue(db,config,'preview');
  const rateLimitStore = new RedisGenerationQueue(config.REDIS_URL,`${config.QUEUE_NAME}:limits`);
  const assets=new CatalogAssetsService([config.RUNTIME_DIR,config.TEMPLATES_DIR],config.TEMPLATES_DIR,objects,join(config.RUNTIME_DIR,'cache','catalog'));
  const catalog=new CustomerCatalogService(new CustomerCatalogModel(db),assets);
  const account=new CustomerAccountService(new CustomerAccountModel(db),{sessionSecret:config.SESSION_SECRET_KEY,sessionDays:config.SESSION_DAYS,cookieSecure:config.COOKIE_SECURE||config.NODE_ENV==='production'},new GoogleIdentityService(config.GOOGLE_CLIENT_ID),assets);
  const results=new CustomerResultService(new CustomerResultModel(db),{resultsDir:join(config.RUNTIME_DIR,'results'),claimHours:config.RESULT_CLAIM_TTL_HOURS,publicOrigin:config.RESULT_CLAIM_PUBLIC_BASE_URL,production:config.NODE_ENV==='production',kioskResetSeconds:config.KIOSK_RESET_SECONDS},objects);
  const imageBase=config.IMAGE_ENGINE_BASE_URL.replace(/\/$/,'');
  const uploads=new CustomerUploadService(new CustomerUploadModel(db),new UploadImageEngineService(config.IMAGE_ENGINE_NORMALIZE_URL||(imageBase?`${imageBase}/normalize-upload`:''),config.AI_ENGINE_API_KEY),{uploadsDir:join(config.RUNTIME_DIR,'uploads'),retentionHours:config.UPLOAD_RETENTION_HOURS},objects);
  const model=new CustomerGenerationModel(db,config.WORKER_MAX_ATTEMPTS),generations=new CustomerGenerationService(model,uploads,assets,queue,config.BASIC_MODEL_EXPERIENCE_ID);
  const kiosk = config.NATIVE_KIOSK_ENABLED ? new NativeKioskService(new NativeKioskModel(db),uploads,generations,results,{
    apiKey: config.KIOSK_API_KEY,ttlSeconds: config.KIOSK_PHOTO_SESSION_TTL_SECONDS,generationLimit: config.KIOSK_GENERATION_LIMIT,
    secureCookie: account.config.cookieSecure }) : undefined;
  const provider=config.AI_PROVIDER==='9router'?new NativeNineRouterProvider({baseUrl:config.NINEROUTER_BASE_URL,key:config.NINEROUTER_API_KEY,timeoutMs:config.NINEROUTER_TIMEOUT_SECONDS*1000,resultOrigins:config.PROVIDER_RESULT_ORIGINS}):new NativeNullProvider();
  const images=new NativeImageEngineService(imageBase,config.AI_ENGINE_API_KEY);
  const classic=new ClassicGenerationRunner(model,uploads,assets,new ClassicImageEngineService(imageBase?`${imageBase}/compose-classic`:'',config.AI_ENGINE_API_KEY));
  const runner=new NativeGenerationRunner(model,new ProviderRunModel(db),uploads,classic,images,provider,config.BASIC_MODEL_EXPERIENCE_ID,assets);
  const worker=new CustomerGenerationWorkerService(model,runner,join(config.RUNTIME_DIR,'results'),objects);
  const adminModel=new AdminDataModel(db),adminCatalog=new AdminCatalogService(adminModel,assets,{templatesDir:config.TEMPLATES_DIR,tmpDir:join(config.RUNTIME_DIR,'tmp'),minDimension:config.UPLOAD_MIN_DIMENSION,maxDimension:config.UPLOAD_MAX_DIMENSION});
  const operations=new AdminOperationsService(adminModel,assets,{environment:config.NODE_ENV,ai_provider:config.AI_PROVIDER,google_configured:Boolean(config.GOOGLE_CLIENT_ID.trim()),upload_max_bytes:config.UPLOAD_MAX_BYTES,upload_min_dimension:config.UPLOAD_MIN_DIMENSION,upload_max_dimension:config.UPLOAD_MAX_DIMENSION,admin_default_role:config.ADMIN_DEFAULT_ROLE});
  const previews=new AdminPreviewService(adminModel,adminCatalog,previewQueue,model.leases,provider,images);
  const admin={auth:new AdminAuthService(new AdminAuthModel(db),account.signer,{token:config.ADMIN_TOKEN,defaultRole:config.ADMIN_DEFAULT_ROLE,sessionDays:config.SESSION_DAYS,cookieSecure:account.config.cookieSecure}),catalog:adminCatalog,operations,usage:new AdminUsageService(operations,results),previews};
  const queueReady=async()=>{await queue.ping();await previewQueue.ping();};
  const health=async()=>{let database='ok',redis='ok',storage='ok',dispatch='ok';try{await db.$queryRaw`SELECT 1`;}catch{database='error: unreachable';}try{await rateLimitStore.ping();}catch{redis='error: unreachable';}try{await queueReady();}catch{dispatch='error: unreachable';}try{await storageReady();}catch{storage='error: unreachable';}const connected=provider.available();return {status:database==='ok'&&redis==='ok'&&storage==='ok'&&dispatch==='ok'?'ok':'degraded',app:'NXBooth',environment:config.NODE_ENV,checks:{database,redis,storage,queue:dispatch,ai_provider:`${connected?'ok':'not_connected'} (${provider.name})`},queue_backend:config.GENERATION_QUEUE_BACKEND,ai_provider:provider.name,ai_provider_connected:connected};};
  return {catalog,account,results,uploads,generations,kiosk,queue,previewQueue,worker,previews,leases:model.leases,admin,health,storageReady,queueReady,limiter:new NativeRateLimitService(rateLimitStore),async close(){await queue.close();await previewQueue.close();await rateLimitStore.close();}};
}

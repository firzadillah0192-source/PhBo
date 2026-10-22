import { GenerationWebhookModel } from './models/generation-webhook.model.js';
import { GenerationWebhookService } from './services/generation-webhook.service.js';
import { WebhookVault } from './services/webhook-security.js';
import { DeveloperDashboardModel } from './models/developer-dashboard.model.js';
import { DeveloperDashboardService } from './services/developer-dashboard.service.js';
import { PhotoFolderModel } from './models/photo-folder.model.js';
import { PhotoFolderService } from './services/photo-folder.service.js';
import { PublicApiKeyModel } from './models/public-api-key.model.js';
import { PublicApiKeyService } from './services/public-api-key.service.js';
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
import { KioskDeviceModel } from './models/kiosk-device.model.js';
import { KioskDeviceService } from './services/kiosk-device.service.js';
import { accountCookie } from './services/customer-credentials.service.js';
import { LabService } from './lab/service.js';
import { LabVault } from './lab/crypto.js';
import { PgLabStore } from './lab/store.js';
import { DiskLabFiles } from './lab/files.js';
import { NxScenarios } from './lab-bridge/nx-scenarios.js';
import { ADAPTERS } from './lab/adapters/index.js';
import { nativeGenerationQueue } from './services/native-generation-queue.js';
import { SubscriptionWalletModel } from './models/subscription-wallet.model.js';
import { GenerationApiRoutesService } from './services/generation-api-routes.service.js';
import { PaymentModel } from './models/payment.model.js';
import { PaymentService } from './services/payment.service.js';
import { DuitkuSandboxGateway } from './services/duitku-sandbox.service.js';

export function migrationContainer(db:PrismaClient,config:z.output<typeof migrationConfigSchema>){
  if(config.GENERATION_WEBHOOKS_ENABLED && (!config.PUBLIC_API_KEY_PEPPER || !config.SUBSCRIPTION_V2_ENABLED || !config.PUBLIC_API_GENERATION_ENABLED))throw new Error('Webhooks require public generation and subscription wallet');
  const webhookModel=config.GENERATION_WEBHOOKS_ENABLED?new GenerationWebhookModel(db):undefined;
  const webhooks=webhookModel?new GenerationWebhookService(webhookModel,new WebhookVault(config.WEBHOOK_SECRET_ENCRYPTION_VERSION,config.WEBHOOK_SECRET_ENCRYPTION_KEY)):undefined;
  const publicClient = config.MINIO_SIGNED_URLS_ENABLED ? new Client({ endPoint: config.MINIO_PUBLIC_ENDPOINT,port: config.MINIO_PUBLIC_PORT,
    useSSL: config.MINIO_PUBLIC_USE_SSL,accessKey: config.MINIO_ACCESS_KEY,secretKey: config.MINIO_SECRET_KEY,region: config.MINIO_REGION }) : undefined;
  const publicOrigin = `${config.MINIO_PUBLIC_USE_SSL?'https':'http'}://${config.MINIO_PUBLIC_ENDPOINT}${config.MINIO_PUBLIC_PORT===(config.MINIO_PUBLIC_USE_SSL?443:80)?'':`:${config.MINIO_PUBLIC_PORT}`}`;
  const objects = config.STORAGE_BACKEND === 'minio' ? new NativeObjectStorage(new Client({ endPoint: config.MINIO_ENDPOINT, port: config.MINIO_PORT, useSSL: config.MINIO_USE_SSL, accessKey: config.MINIO_ACCESS_KEY, secretKey: config.MINIO_SECRET_KEY, region: config.MINIO_REGION }), config.MINIO_BUCKET,
    publicClient ? { client: publicClient,origin: publicOrigin,ttlSeconds: config.MINIO_PRESIGNED_URL_TTL_SECONDS } : undefined) : undefined;
  const storageReady = async () => {
    await objects?.health();
    if(webhookModel)await db.$queryRaw`SELECT e.id,d.lease_token,a.attempt_number FROM integration_webhook_endpoints e LEFT JOIN integration_webhook_deliveries d ON false LEFT JOIN integration_webhook_attempts a ON false LIMIT 0`;
    if(config.PUBLIC_API_GENERATION_ENABLED && !config.SUBSCRIPTION_V2_ENABLED) throw new Error('Public generation requires subscription v2');
    if(config.PUBLIC_API_KEY_PEPPER) await db.$queryRaw`SELECT k.secret_hash,u.key_id FROM integration_api_keys k LEFT JOIN integration_api_key_usage u ON false LIMIT 0`;
    if(config.PHOTO_FOLDERS_ENABLED){
      if(!config.SUBSCRIPTION_V2_ENABLED)throw new Error('Photo folders require subscription v2');
      await db.$queryRaw`SELECT f.id,p.default_folder_id,d.job_id,r.result_id,s.token_hash FROM photo_folders f LEFT JOIN photo_folder_preferences p ON false LEFT JOIN generation_folder_destinations d ON false LEFT JOIN photo_folder_results r ON false LEFT JOIN photo_folder_shares s ON false LIMIT 0`;
    }
    if (config.SUBSCRIPTION_V2_ENABLED) {
      // Read-only schema readiness; never applies SQL or migrates balances here.
      await db.$queryRaw`SELECT w.owner_scope,j.lane,r.expires_at,c.encrypted_key,l.currency FROM subscription_v2_wallets w LEFT JOIN subscription_v2_jobs j ON false LEFT JOIN subscription_v2_results r ON false LEFT JOIN generation_api_routes c ON false LEFT JOIN subscription_v2_ledger l ON false LIMIT 0`;
      await db.$queryRaw`SELECT product_kind,product_code,policy_version FROM payment_transactions LIMIT 0`;
    }
  };
  const queue=nativeGenerationQueue(db,config,'customer'),previewQueue=nativeGenerationQueue(db,config,'preview');
  const rateLimitStore = new RedisGenerationQueue(config.REDIS_URL,`${config.QUEUE_NAME}:limits`);
  const assets=new CatalogAssetsService([config.RUNTIME_DIR,config.TEMPLATES_DIR],config.TEMPLATES_DIR,objects,join(config.RUNTIME_DIR,'cache','catalog'));
  const catalog=new CustomerCatalogService(new CustomerCatalogModel(db),assets);
  const payments=new PaymentService(new PaymentModel(db),new DuitkuSandboxGateway({merchantCode:config.DUITKU_MERCHANT_CODE,apiKey:config.DUITKU_API_KEY}),{enabled:config.DUITKU_ENABLED,publicOrigin:config.DUITKU_PUBLIC_ORIGIN,creditRupiah:config.SUBSCRIPTION_V2_ENABLED?10:100});
  const subscriptions = config.SUBSCRIPTION_V2_ENABLED ? new SubscriptionWalletModel(db) : undefined;
  const apiRoutes = config.SUBSCRIPTION_V2_ENABLED ? new GenerationApiRoutesService(db, { sessionSecret: config.SESSION_SECRET_KEY, baseUrl: config.NINEROUTER_BASE_URL, standardKey: config.NINEROUTER_API_KEY, timeoutMs: config.NINEROUTER_TIMEOUT_SECONDS * 1000, resultOrigins: config.PROVIDER_RESULT_ORIGINS }) : undefined;
  const account=new CustomerAccountService(new CustomerAccountModel(db,config.SUBSCRIPTION_V2_ENABLED),{sessionSecret:config.SESSION_SECRET_KEY,sessionDays:config.SESSION_DAYS,cookieSecure:config.COOKIE_SECURE||config.NODE_ENV==='production'},new GoogleIdentityService(config.GOOGLE_CLIENT_ID),assets,payments,subscriptions,apiRoutes,config.PHOTO_FOLDERS_ENABLED);
  const results=new CustomerResultService(new CustomerResultModel(db,subscriptions),{resultsDir:join(config.RUNTIME_DIR,'results'),claimHours:config.RESULT_CLAIM_TTL_HOURS,publicOrigin:config.RESULT_CLAIM_PUBLIC_BASE_URL,production:config.NODE_ENV==='production',kioskResetSeconds:config.KIOSK_RESET_SECONDS},objects);
  const folderModel=config.PHOTO_FOLDERS_ENABLED?new PhotoFolderModel(db):undefined;
  const folders=folderModel?new PhotoFolderService(folderModel,results,config.RESULT_CLAIM_PUBLIC_BASE_URL):undefined;
  const imageBase=config.IMAGE_ENGINE_BASE_URL.replace(/\/$/,'');
  const uploads=new CustomerUploadService(new CustomerUploadModel(db),new UploadImageEngineService(config.IMAGE_ENGINE_NORMALIZE_URL||(imageBase?`${imageBase}/normalize-upload`:''),config.AI_ENGINE_API_KEY),{uploadsDir:join(config.RUNTIME_DIR,'uploads'),retentionHours:config.UPLOAD_RETENTION_HOURS},objects);
  const model=new CustomerGenerationModel(db,config.WORKER_MAX_ATTEMPTS,subscriptions,folderModel,webhookModel),generations=new CustomerGenerationService(model,uploads,assets,queue,config.BASIC_MODEL_EXPERIENCE_ID,apiRoutes);
  // Desktop kiosks sign in per account (device-code flow); see docs/DESKTOP_LOGIN_PLAN.md.
  const devices=new KioskDeviceService(new KioskDeviceModel(db),async cookies=>{
    if(!account.signer.unsign(cookies[accountCookie]))return null;
    const identity=await account.resolve(cookies);return identity.account?{id:identity.account.id,email:identity.account.email}:null;
  },{sessionDays:14,activationUrl:`${config.RESULT_CLAIM_PUBLIC_BASE_URL.replace(/\/$/,'')||'https://nxbooth.gennexbyte.com'}/kiosk-activate.html`});
  const kiosk = config.NATIVE_KIOSK_ENABLED ? new NativeKioskService(new NativeKioskModel(db),uploads,generations,results,{
    apiKey: config.KIOSK_API_KEY,ttlSeconds: config.KIOSK_PHOTO_SESSION_TTL_SECONDS,generationLimit: config.KIOSK_GENERATION_LIMIT,
    secureCookie: account.config.cookieSecure,devices }) : undefined;
  const provider=config.AI_PROVIDER==='9router'?new NativeNineRouterProvider({baseUrl:config.NINEROUTER_BASE_URL,key:config.NINEROUTER_API_KEY,timeoutMs:config.NINEROUTER_TIMEOUT_SECONDS*1000,resultOrigins:config.PROVIDER_RESULT_ORIGINS}):new NativeNullProvider();
  const images=new NativeImageEngineService(imageBase,config.AI_ENGINE_API_KEY);
  const classic=new ClassicGenerationRunner(model,uploads,assets,new ClassicImageEngineService(imageBase?`${imageBase}/compose-classic`:'',config.AI_ENGINE_API_KEY));
  const runner=new NativeGenerationRunner(model,new ProviderRunModel(db),uploads,classic,images,provider,config.BASIC_MODEL_EXPERIENCE_ID,assets,apiRoutes);
  const worker=new CustomerGenerationWorkerService(model,runner,join(config.RUNTIME_DIR,'results'),objects);
  const adminModel=new AdminDataModel(db),adminCatalog=new AdminCatalogService(adminModel,assets,{templatesDir:config.TEMPLATES_DIR,tmpDir:join(config.RUNTIME_DIR,'tmp'),minDimension:config.UPLOAD_MIN_DIMENSION,maxDimension:config.UPLOAD_MAX_DIMENSION});
  const operations=new AdminOperationsService(adminModel,assets,{environment:config.NODE_ENV,ai_provider:config.AI_PROVIDER,google_configured:Boolean(config.GOOGLE_CLIENT_ID.trim()),upload_max_bytes:config.UPLOAD_MAX_BYTES,upload_min_dimension:config.UPLOAD_MIN_DIMENSION,upload_max_dimension:config.UPLOAD_MAX_DIMENSION,admin_default_role:config.ADMIN_DEFAULT_ROLE},subscriptions);
  const previews=new AdminPreviewService(adminModel,adminCatalog,previewQueue,model.leases,provider,images);
  // AI Provider Lab: own tables, own credential vault, own files; shares only the admin auth + audit log.
  const lab=new LabService({store:new PgLabStore(db,db),files:new DiskLabFiles(join(config.RUNTIME_DIR,'lab')),vault:new LabVault(config.LAB_ENCRYPTION_KEY),adapters:ADAPTERS,
    autoBilling:true,scenarios:new NxScenarios(new CustomerCatalogModel(db),assets,images,config.BASIC_MODEL_EXPERIENCE_ID),
    policy:config.NINEROUTER_BASE_URL.trim()?{internalOrigin:config.NINEROUTER_BASE_URL}:{},maxUploadBytes:config.UPLOAD_MAX_BYTES,
    audit:async(actor,action,type,target,reason,metadata)=>{await adminModel.transaction(tx=>adminModel.audit(tx,actor,action,type,target,reason,metadata));}});
  const admin={auth:new AdminAuthService(new AdminAuthModel(db),account.signer,{token:config.ADMIN_TOKEN,defaultRole:config.ADMIN_DEFAULT_ROLE,sessionDays:config.SESSION_DAYS,cookieSecure:account.config.cookieSecure}),catalog:adminCatalog,operations,usage:new AdminUsageService(operations,results),previews,lab,payments,apiRoutes};
  const queueReady=async()=>{await queue.ping();await previewQueue.ping();};
  const health=async()=>{let database='ok',redis='ok',storage='ok',dispatch='ok';try{await db.$queryRaw`SELECT 1`;}catch{database='error: unreachable';}try{await rateLimitStore.ping();}catch{redis='error: unreachable';}try{await queueReady();}catch{dispatch='error: unreachable';}try{await storageReady();}catch{storage='error: unreachable';}const connected=provider.available();return {status:database==='ok'&&redis==='ok'&&storage==='ok'&&dispatch==='ok'?'ok':'degraded',app:'NXBooth',environment:config.NODE_ENV,checks:{database,redis,storage,queue:dispatch,ai_provider:`${connected?'ok':'not_connected'} (${provider.name})`},queue_backend:config.GENERATION_QUEUE_BACKEND,ai_provider:provider.name,ai_provider_connected:connected};};
  // Public API stays unmounted until a pepper is configured; keys are HMAC-hashed with it.
  const publicKeyModel=new PublicApiKeyModel(db,Boolean(webhooks));
  const publicApi=config.PUBLIC_API_KEY_PEPPER?{keys:new PublicApiKeyService(publicKeyModel,config.PUBLIC_API_KEY_PEPPER),keyModel:publicKeyModel,webhooks,dashboard:subscriptions?new DeveloperDashboardService(new DeveloperDashboardModel(db),subscriptions):undefined,generationEnabled:config.PUBLIC_API_GENERATION_ENABLED,window:(key:string,seconds:number)=>rateLimitStore.window(key,seconds)}:undefined;
  return {catalog,account,publicApi,webhooks,folders,results,uploads,generations,kiosk,devices,queue,previewQueue,worker,previews,leases:model.leases,admin,health,storageReady,queueReady,limiter:new NativeRateLimitService(rateLimitStore),async close(){await queue.close();await previewQueue.close();await rateLimitStore.close();}};
}

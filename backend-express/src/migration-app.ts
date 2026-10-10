import {installAnalytics} from './services/analytics.service.js';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { ZodError } from 'zod';
import type { ErrorRequestHandler } from 'express';
import type { CustomerCatalogService } from './services/customer-catalog.service.js';
import { customerCatalogRoutes } from './routes/customer-catalog.routes.js';
import { AppError } from './lib/errors.js';
import type { CustomerAccountService } from './services/customer-account.service.js';
import { customerAccountRoutes } from './routes/customer-account.routes.js';
import type { CustomerResultService } from './services/customer-result.service.js';
import { customerResultRoutes } from './routes/customer-result.routes.js';
import type { CustomerUploadService } from './services/customer-upload.service.js';
import { customerUploadRoutes } from './routes/customer-upload.routes.js';
import multer from 'multer';
import type { CustomerGenerationService } from './services/customer-generation.service.js';
import { customerGenerationRoutes } from './routes/customer-generation.routes.js';
import type { NativeAdminServices } from './controllers/admin.controller.js';
import { nativeAdminRoutes } from './routes/admin.routes.js';
import type { NativeRateLimitService } from './services/native-rate-limit.service.js';
import type { NativeKioskService } from './services/native-kiosk.service.js';
import { kioskWebAccess } from './routes/kiosk-web.routes.js';
import { nativeKioskRoutes } from './routes/native-kiosk.routes.js';

export type MigrationAppConfig = { corsOrigins: string[]; uploadMaxBytes?: number; trustProxy?: boolean; admin?:NativeAdminServices; limiter?:NativeRateLimitService; health?:()=>Promise<object>; kiosk?: NativeKioskService };

// Candidate /api contract, independent of the incompatible upstream /api/v1 API.
// Unported routes remain unavailable; there is no forwarding to FastAPI.
export function createMigrationApp(catalog: CustomerCatalogService, config: MigrationAppConfig, account?: CustomerAccountService, results?: CustomerResultService, uploads?: CustomerUploadService, generations?: CustomerGenerationService) {
  const app = express();
  app.disable('x-powered-by');
  if(config.trustProxy)app.set('trust proxy',1);
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use('/api', (_req, res, next) => {
    res.set({ 'Cache-Control': 'private, no-store, no-cache, max-age=0, must-revalidate',
      'CDN-Cache-Control': 'no-store', 'Cloudflare-CDN-Cache-Control': 'no-store', Pragma: 'no-cache' });
    res.vary('Cookie');
    next();
  });
  app.use((req,_res,next)=>{
    const origin=req.get('origin');
    if(origin&&!['GET','HEAD','OPTIONS'].includes(req.method)){
      let sameHost=false;
      try{const url=new URL(origin);const host=req.get('x-forwarded-host')||req.get('host');sameHost=['http:','https:'].includes(url.protocol)&&url.host===host;}catch{}
      if(!sameHost&&!config.corsOrigins.includes(origin)){next(new AppError(403,req.path.startsWith('/api/admin')?'CSRF_BLOCKED':'ORIGIN_FORBIDDEN',req.path.startsWith('/api/admin')?'Cross-site admin mutation blocked.':'Origin is not allowed'));return;}
    }next();
  });
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());
  installAnalytics(app);
  if (config.kiosk) app.use('/api/v1',nativeKioskRoutes(config.kiosk,catalog,config.uploadMaxBytes ?? 12*1024*1024));
  app.get('/health', (_req, res) => { res.json({ status: 'ok', service: 'nxbooth-express' }); });
  if(config.health)app.get('/api/health',async(_req,res)=>{res.json(await config.health!());});
  if(config.admin)app.use('/api/admin',nativeAdminRoutes(config.admin,config.uploadMaxBytes??12*1024*1024));
  // Restricted web kiosk uses the existing signed account session and provider pipeline.
  if(account){
    app.use('/api/kiosk',kioskWebAccess(account));
    app.use('/api/kiosk/web',customerCatalogRoutes(catalog));
    app.use('/api/kiosk/web/account',customerAccountRoutes(account));
    if(results)app.use('/api/kiosk/web',customerResultRoutes(results,account,config.limiter));
    if(uploads)app.use('/api/kiosk/web',customerUploadRoutes(uploads,account,config.uploadMaxBytes??12*1024*1024));
    if(generations)app.use('/api/kiosk/web',customerGenerationRoutes(generations,account));
  }
  app.use('/api', customerCatalogRoutes(catalog));
  if (account) app.use('/api/account', customerAccountRoutes(account));
  if (account && results) app.use('/api', customerResultRoutes(results, account,config.limiter));
  if (account && uploads) app.use('/api', customerUploadRoutes(uploads, account, config.uploadMaxBytes ?? 12 * 1024 * 1024));
  if (account && generations) app.use('/api', customerGenerationRoutes(generations, account));
  app.use((_req, res) => { res.status(404).json({ detail: 'Not Found' }); });
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof AppError) {
      res.status(error.status).json({ detail: error.code === 'CATALOG_ASSET_NOT_FOUND' ? error.message : { error_code: error.code, message: error.message } }); return;
    }
    if (error instanceof ZodError) { res.status(422).json({ detail: { error_code: 'VALIDATION_FAILED', message: 'Invalid request.' } }); return; }
    if(error&&typeof error==='object'&&'code' in error){if(error.code==='P2002'){res.status(409).json({detail:{error_code:'RECORD_EXISTS',message:'This record already exists.'}});return;}if(error.code==='P2025'){res.status(404).json({detail:{error_code:'RECORD_NOT_FOUND',message:'This record is unavailable.'}});return;}}
    if (error instanceof multer.MulterError) { res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ detail: { error_code: 'VALIDATION_FAILED', message: 'The photo upload could not be accepted.' } }); return; }
    if (error instanceof Error && 'type' in error && error.type === 'entity.parse.failed') { res.status(400).json({ detail: 'Invalid JSON body' }); return; }
    if (error instanceof Error && 'type' in error && error.type === 'entity.too.large') { res.status(413).json({ detail: 'Request body is too large' }); return; }
    // Do not log exceptions that may contain registry paths, credentials, or tokens.
    res.status(500).json({ error_code: 'INTERNAL_ERROR', message: 'The request could not be completed. Please try again.' });
  };
  if(app.locals.posthogErrorCapture)app.use(app.locals.posthogErrorCapture);
  app.use(errors);
  return app;
}

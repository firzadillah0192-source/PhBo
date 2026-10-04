import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { migrationConfigSchema } from './config/migration-env.js';
import { createMigrationApp } from './migration-app.js';
import { migrationContainer } from './migration-container.js';

const config=migrationConfigSchema.parse(process.env);
const db=new PrismaClient({adapter:new PrismaPg({connectionString:config.DATABASE_URL})});
const services=migrationContainer(db,config);
try{
  await db.$connect();
  await services.storageReady();
  await services.queueReady();
  // Require mapped legacy tables and the additive lease migration. Startup
  // never applies schema changes or seeds/publishes assets.
  await Promise.all([db.nxTemplate.count(),db.nxExperience.count(),db.nxClassicLayout.count(),db.nxFrameStyle.count(),db.nxOrnament.count(),db.nxAccount.count(),db.nxGuestSession.count(),db.nxAuthSession.count(),db.nxResult.findFirst({select:{deleted_at:true}}),db.nxResultClaim.count(),db.nxProviderRun.count(),db.nxPlan.count(),db.nxSubscription.count(),db.nxAuditLog.count(),db.nxAdminUser.count(),db.nxPreviewJob.count(),db.nxPreviewSource.count(),db.nxWorkerLease.count()]);
  if (services.kiosk) {
    await db.$queryRaw`SELECT public_code,access_token_hash FROM kiosk_sessions LIMIT 0`;
    await db.$queryRaw`SELECT owner_scope,request_key FROM generation_requests LIMIT 0`;
  }
  const server=createMigrationApp(services.catalog,{corsOrigins:config.CORS_ORIGINS,uploadMaxBytes:config.UPLOAD_MAX_BYTES,trustProxy:config.TRUST_PROXY,admin:services.admin,health:services.health,limiter:services.limiter,kiosk:services.kiosk},services.account,services.results,services.uploads,services.generations).listen(config.PORT,config.HOST);
  server.on('listening',()=>console.log('NXBooth Express migration candidate listening'));
  let stopping=false;
  const stop=()=>{if(stopping)return;stopping=true;const timeout=setTimeout(()=>process.exit(1),10000).unref();server.close(async()=>{await services.close();await db.$disconnect();clearTimeout(timeout);});};
  server.on('error',()=>{console.error('Candidate listener failed');process.exitCode=1;stop();});
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}catch{console.error('Candidate startup failed; check database, mapped schema and storage configuration');await services.close();await db.$disconnect();process.exitCode=1;}

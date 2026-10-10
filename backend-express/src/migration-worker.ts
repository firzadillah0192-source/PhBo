import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { migrationConfigSchema } from './config/migration-env.js';
import { migrationContainer } from './migration-container.js';
import { nativeGenerationQueue } from './services/native-generation-queue.js';
import { failedStage, startupStage } from './lib/startup-stage.js';
import { NativeWorkerLoop } from './services/native-worker-loop.service.js';

const config=migrationConfigSchema.parse(process.env);
const db=new PrismaClient({adapter:new PrismaPg({connectionString:config.DATABASE_URL})});
const services=migrationContainer(db,config);
const customers=nativeGenerationQueue(db,config,'customer'),previews=nativeGenerationQueue(db,config,'preview');
let nextCleanup=0;
const maintain=async()=>{for(const row of await services.leases.recoverable('customer'))await services.queue.enqueue(row.id);if(Date.now()>=nextCleanup){await services.uploads.cleanup();await services.results.cleanup();nextCleanup=Date.now()+config.UPLOAD_CLEANUP_INTERVAL_SECONDS*1000;}};
const customerLoop=new NativeWorkerLoop(customers,id=>services.worker.process(id),maintain);
const previewLoop=new NativeWorkerLoop(previews,id=>services.previews.process(id),async()=>{for(const row of await services.leases.recoverable('preview'))await services.previewQueue.enqueue(row.id);});
let stopping=false;
function stop(){if(stopping)return;stopping=true;customerLoop.stop();previewLoop.stop();}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
try{await startupStage('database',()=>db.$connect());await startupStage('storage',()=>services.storageReady());await startupStage('queue',()=>services.queueReady());await startupStage('schema',()=>db.nxWorkerLease.count());console.log('NXBooth native candidate worker started');await Promise.all([customerLoop.run(),previewLoop.run()]);}
catch(error){console.error(`Native candidate worker startup failed at stage: ${failedStage(error)}`);process.exitCode=1;}
finally{await customers.close();await previews.close();await services.close();await db.$disconnect();}

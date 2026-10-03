import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { migrationConfigSchema } from './config/migration-env.js';
import { migrationContainer } from './migration-container.js';
import { RedisGenerationQueue } from './services/redis-generation-queue.service.js';
import { NativeWorkerLoop } from './services/native-worker-loop.service.js';

const config=migrationConfigSchema.parse(process.env);
const db=new PrismaClient({adapter:new PrismaPg({connectionString:config.DATABASE_URL})});
const services=migrationContainer(db,config);
const customers=new RedisGenerationQueue(config.REDIS_URL,config.QUEUE_NAME),previews=new RedisGenerationQueue(config.REDIS_URL,config.PREVIEW_QUEUE_NAME);
let nextCleanup=0;
const maintain=async()=>{for(const row of await services.leases.recoverable('customer'))await services.queue.enqueue(row.id);if(Date.now()>=nextCleanup){await services.uploads.cleanup();nextCleanup=Date.now()+config.UPLOAD_CLEANUP_INTERVAL_SECONDS*1000;}};
const customerLoop=new NativeWorkerLoop(customers,id=>services.worker.process(id),maintain);
const previewLoop=new NativeWorkerLoop(previews,id=>services.previews.process(id),async()=>{for(const row of await services.leases.recoverable('preview'))await services.previewQueue.enqueue(row.id);});
let stopping=false;
function stop(){if(stopping)return;stopping=true;customerLoop.stop();previewLoop.stop();}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
try{await db.$connect();await db.nxWorkerLease.count();console.log('NXBooth native candidate worker started');await Promise.all([customerLoop.run(),previewLoop.run()]);}
catch{console.error('Native candidate worker startup failed');process.exitCode=1;}
finally{await customers.close();await previews.close();await services.close();await db.$disconnect();}

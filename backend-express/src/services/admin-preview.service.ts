import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { NxPreviewSource } from '@prisma/client';
import type { AdminDataModel } from '../models/admin-data.model.js';
import type { WorkerLeaseModel } from '../models/worker-lease.model.js';
import type { AdminCatalogService } from './admin-catalog.service.js';
import type { AdminPrincipal } from './admin-auth.service.js';
import type { GenerationQueue } from './customer-generation.service.js';
import type { NativeAIProvider } from './native-provider.service.js';
import type { NativeImageEngineService } from './native-image-engine.service.js';
import { legacyId } from './customer-credentials.service.js';
import { AppError } from '../lib/errors.js';

export const originalPreviewGuard = "Create a wholly original, commercially safe marketing artwork using the supplied internal canonical demo portrait as the only subject reference and applying the private experience direction below. The source is a fictional adult created for internal product marketing, not a customer upload. Do not use or imitate copyrighted characters, franchise worlds, logos, brand identities, protected symbols, or any named living artist's signature style. Do not reproduce a real person's likeness beyond the supplied internal source. Avoid readable text and logos unless the experience direction explicitly requires an editorial layout; keep any text generic and original.";
export class AdminPreviewService {
  constructor(private readonly model: AdminDataModel, private readonly catalog: AdminCatalogService, private readonly queue: GenerationQueue,
    private readonly leases: WorkerLeaseModel, private readonly provider: NativeAIProvider, private readonly images: NativeImageEngineService) {}
  private async defaultSource() {
    const path=join(this.catalog.config.templatesDir,'_preview_sources','portrait-default.png');const exists=Boolean(await this.catalog.assets.file(path));
    return this.model.read(db=>db.nxPreviewSource.upsert({where:{id:'portrait-default'},update:exists?{storage_path:path,content_type:'image/png',active:true}:{},create:{id:'portrait-default',source_type:'portrait',updated_by:'system',...(exists?{storage_path:path,content_type:'image/png'}:{})}}));
  }
  private async sourceItem(row:NxPreviewSource){return {id:row.id,source_type:row.source_type,has_asset:row.active&&Boolean(await this.catalog.assets.file(row.storage_path)),content_type:row.content_type,updated_at:row.updated_at,updated_by:row.updated_by};}
  async sources(){await this.defaultSource();return Promise.all((await this.model.read(db=>db.nxPreviewSource.findMany({orderBy:{id:'asc'}}))).map(row=>this.sourceItem(row)));}
  async sourceAsset(id:string){const row=await this.model.read(db=>db.nxPreviewSource.findUnique({where:{id}}));const path=row?.active?await this.catalog.assets.file(row.storage_path):null;if(!path)throw new AppError(404,'PREVIEW_SOURCE_NOT_FOUND','Preview source unavailable.');return path;}
  async replaceSource(id:string,file:Express.Multer.File|undefined,actor:AdminPrincipal){if(id!=='portrait-default')throw new AppError(422,'VALIDATION_FAILED','Only the portrait canonical source is enabled right now.');const target=join(this.catalog.config.templatesDir,'_preview_sources',`${id}.png`);await this.catalog.saveImage(file,target);const row=await this.model.transaction(async tx=>{const row=await tx.nxPreviewSource.upsert({where:{id},update:{storage_path:target,content_type:'image/png',active:true,updated_at:new Date(),updated_by:actor.actor_id},create:{id,storage_path:target,content_type:'image/png',updated_by:actor.actor_id}});await this.model.audit(tx,actor,'preview_source_changed','preview_source',id);return row;});return this.sourceItem(row);}
  async job(id:string){const row=await this.model.read(db=>db.nxPreviewJob.findUnique({where:{id}}));if(!row)throw new AppError(404,'PREVIEW_JOB_NOT_FOUND','Preview job unavailable.');const {output_path,requested_by,...data}=row;return data;}
  async enqueue(experienceId:string,actor:AdminPrincipal,sourceId='portrait-default'){
    if(sourceId==='portrait-default')await this.defaultSource();if(sourceId!=='prompt-only')await this.sourceAsset(sourceId);
    const row=await this.model.transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM admin_experiences WHERE id=${experienceId} FOR UPDATE`;
      if(!await tx.nxExperience.findUnique({where:{id:experienceId}}))throw new AppError(404,'EXPERIENCE_NOT_FOUND','Experience unavailable.');
      const active=await tx.nxPreviewJob.findFirst({where:{experience_id:experienceId,state:{in:['QUEUED','PROCESSING']}}});if(active)return active;
      await tx.nxExperience.update({where:{id:experienceId},data:{preview_status:'GENERATING',preview_error:null,updated_at:new Date(),updated_by:actor.actor_id}});
      const job=await tx.nxPreviewJob.create({data:{id:legacyId(),experience_id:experienceId,source_id:sourceId,requested_by:actor.actor_id}});
      await this.model.audit(tx,actor,'experience_preview_generation_requested','experience',experienceId,'',{purpose:'admin_preview_generation'});return job;
    });
    try{await this.queue.enqueue(row.id);}catch{await this.model.transaction(async tx=>{await tx.nxPreviewJob.updateMany({where:{id:row.id,state:'QUEUED'},data:{state:'FAILED',error_message:'Preview queue unavailable.',finished_at:new Date()}});await tx.nxExperience.update({where:{id:experienceId},data:{preview_status:'FAILED',preview_error:'Preview queue unavailable.'}});});throw new AppError(503,'QUEUE_UNAVAILABLE','The preview queue is unavailable.');}
    return this.job(row.id);
  }
  async batch(actor:AdminPrincipal,sourceId:string){let skipped_ready=0;const queued=[];for(const row of await this.model.read(db=>db.nxExperience.findMany({orderBy:[{sort_order:'asc'},{id:'asc'}]}))){if(row.preview_status==='READY'&&await this.catalog.assets.file(row.thumbnail_path)){skipped_ready++;continue;}if(row.preview_status==='GENERATING')continue;queued.push(await this.enqueue(row.id,actor,sourceId));}return {queued:queued.length,skipped_ready,jobs:queued};}
  async process(id:string){
    const token=legacyId();const job=await this.model.transaction(async tx=>{const job=await tx.nxPreviewJob.findUnique({where:{id}});if(!job||job.purpose!=='admin_preview_generation'||!['QUEUED','PROCESSING'].includes(job.state)||!await this.leases.acquireIn(tx,'preview',id,token))return null;return tx.nxPreviewJob.update({where:{id},data:{state:'PROCESSING',started_at:job.started_at||new Date(),error_message:null,updated_at:new Date()}});});if(!job)return false;
    const heartbeat=setInterval(()=>{this.leases.renew('preview',id,token).catch(()=>{});},15000).unref();let candidate:string|undefined;
    try{
      const experience=await this.model.read(db=>db.nxExperience.findUnique({where:{id:job.experience_id}}));if(!experience)throw new AppError(404,'EXPERIENCE_NOT_FOUND','Experience unavailable.');
      const source=job.source_id==='prompt-only'?null:await this.images.providerInput(await readFile(await this.sourceAsset(job.source_id)));
      const prompt=`${originalPreviewGuard}\n\nExperience name: ${experience.name}\nExperience description: ${experience.description}\nPrivate experience direction: ${experience.internal_prompt}`;
      const image=await this.provider.generate(source,prompt,experience.model);
      // Write a unique asset: a worker whose lease expires cannot overwrite a
      // newer worker's committed thumbnail. DB publication checks ownership.
      candidate=join(this.catalog.config.templatesDir,'_experience_thumbnails',`${experience.id}-${id}-${token}.png`);
      await this.catalog.saveImage({buffer:image.bytes,mimetype:'image/png'} as Express.Multer.File,candidate);
      const completed=await this.model.transaction(async tx=>{if(!await this.leases.ownedIn(tx,'preview',id,token))return false;await tx.nxPreviewJob.update({where:{id},data:{state:'COMPLETED',output_path:candidate,provider:image.provider,model:image.model,finished_at:new Date(),updated_at:new Date()}});await tx.nxExperience.update({where:{id:experience.id},data:{thumbnail_path:candidate,preview_status:'READY',preview_error:null,updated_at:new Date()}});await this.leases.releaseIn(tx,'preview',id,token);return true;});
      if(!completed)await unlink(candidate);return completed;
    }catch(error){
      // Keep candidate on ambiguous COMMIT; no published asset is removed.
      await this.model.transaction(async tx=>{if(!await this.leases.ownedIn(tx,'preview',id,token))return;const current=await tx.nxPreviewJob.findUnique({where:{id}});if(current?.state==='COMPLETED')return;const message=error instanceof AppError?error.message:'Preview generation failed. Please try again.';await tx.nxPreviewJob.update({where:{id},data:{state:'FAILED',error_message:message,finished_at:new Date(),updated_at:new Date()}});await tx.nxExperience.updateMany({where:{id:job.experience_id},data:{preview_status:'FAILED',preview_error:message,updated_at:new Date()}});await this.leases.releaseIn(tx,'preview',id,token);});return false;
    }finally{clearInterval(heartbeat);}
  }
}

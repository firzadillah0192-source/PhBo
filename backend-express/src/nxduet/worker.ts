import { setTimeout as delay } from 'node:timers/promises';
import type { NativeAIProvider } from '../services/native-provider.service.js';
import { AppError } from '../lib/errors.js';
import { DuetModel } from './model.js';
import { DuetFiles } from './files.js';
import { PREPARATION_PROMPT,validateOverlay } from './policy.js';

export class DuetWorker {
  constructor(readonly model:DuetModel,readonly files:DuetFiles,private readonly provider:NativeAIProvider){}
  async processOne(){
    const job=await this.model.claim();if(!job)return false;
    const token=job.lease_token!;let renewing=false,stored=false,completing=false;
    const heartbeat=setInterval(()=>{if(renewing)return;renewing=true;this.model.renew(job.id,token).catch(()=>{}).finally(()=>{renewing=false;});},15000).unref();
    try{
      const source=await this.files.read(job.id,job.source_path,'source');
      const output=await this.provider.generate(source,PREPARATION_PROMPT,job.model,undefined,undefined,{transparentBackground:true});
      const dimensions=await validateOverlay(output.bytes);
      const path=await this.files.put(job.id,'overlay',output.bytes);stored=true;completing=true;
      const completed=await this.model.finish(job.id,token,{path,...dimensions,size:output.bytes.length,meta:{provider:output.provider,model:output.model,...output.meta}});
      if(!completed)await this.files.remove(job.id,path,'overlay');
    }catch(error){
      if(completing)throw new AppError(503,'NXDUET_COMPLETION_UNCERTAIN','Penyelesaian template perlu diperiksa ulang.');
      if(stored)await this.files.remove(job.id,this.files.path(job.id,'overlay'),'overlay').catch(()=>{});
      await this.model.finish(job.id,token,null,error instanceof AppError?error.code:'NXDUET_PREPARATION_FAILED');
    }finally{clearInterval(heartbeat);}
    return true;
  }
  async maintain(){
    for(const job of await this.model.expired()){
      // Crash recovery fails/refunds instead of issuing a second paid AI request.
      const failed=await this.model.finish(job.id,job.lease_token??'',null,'NXDUET_PREPARATION_INTERRUPTED',true);
      if(failed)await this.files.remove(job.id,this.files.path(job.id,'overlay'),'overlay').catch(()=>{});
    }
    for(const row of await this.model.cleanupRows()){
      let source=false,overlay=false;
      if(row.source_path){await this.files.remove(row.id,row.source_path,'source');source=true;}
      if(row.deleted_at&&row.overlay_path){await this.files.remove(row.id,row.overlay_path,'overlay');overlay=true;}
      await this.model.cleaned(row.id,source,overlay);
    }
  }
  async run(signal:AbortSignal){
    while(!signal.aborted){
      try{await this.maintain();if(await this.processOne())continue;}catch{console.error('NXDuet worker operation failed; durable state retained for recovery.');}
      try{await delay(1500,undefined,{signal});}catch{break;}
    }
  }
}

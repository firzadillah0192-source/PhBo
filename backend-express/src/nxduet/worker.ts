import { setTimeout as delay } from 'node:timers/promises';
import type { NativeAIProvider } from '../services/native-provider.service.js';
import { AppError } from '../lib/errors.js';
import { DuetModel,type DuetPoseOutput } from './model.js';
import { DuetFiles,poseKind } from './files.js';
import { POSE_COUNT,cropCutout,posePrompt,validateOverlay } from './policy.js';

export class DuetWorker {
  constructor(readonly model:DuetModel,readonly files:DuetFiles,private readonly provider:NativeAIProvider){}
  async processOne(){
    const job=await this.model.claim();if(!job)return false;
    const token=job.lease_token!;let renewing=false,completing=false;const stored:string[]=[];
    const heartbeat=setInterval(()=>{if(renewing)return;renewing=true;this.model.renew(job.id,token).catch(()=>{}).finally(()=>{renewing=false;});},15000).unref();
    try{
      const keys=Array.isArray(job.pose_keys)?job.pose_keys:[];
      if(keys.length!==POSE_COUNT)throw new AppError(422,'NXDUET_POSES_MISSING','Pose template tidak lengkap.');
      const source=await this.files.read(job.id,job.source_path,'source');
      const poses:DuetPoseOutput[]=[];let meta:object={};
      // One paid provider call per pose, sequential to keep provider load predictable.
      for(const [index,key] of keys.entries()){
        const slot=index+1;
        const output=await this.provider.generate(source,posePrompt(key),job.model,undefined,undefined,{transparentBackground:true});
        await validateOverlay(output.bytes);
        const cropped=await cropCutout(output.bytes);
        const path=await this.files.put(job.id,poseKind(slot),cropped.bytes);stored.push(path);
        poses.push({slot,key,path,width:cropped.width,height:cropped.height,size:cropped.bytes.length});
        meta={provider:output.provider,model:output.model,...output.meta};
      }
      completing=true;
      const completed=await this.model.finish(job.id,token,{poses,meta});
      if(!completed)await this.removeAll(job.id);
    }catch(error){
      if(completing)throw new AppError(503,'NXDUET_COMPLETION_UNCERTAIN','Penyelesaian template perlu diperiksa ulang.');
      if(stored.length)await this.removeAll(job.id);
      await this.model.finish(job.id,token,null,error instanceof AppError?error.code:'NXDUET_PREPARATION_FAILED');
    }finally{clearInterval(heartbeat);}
    return true;
  }
  private async removeAll(id:string){for(const slot of [1,2,3])await this.files.remove(id,this.files.path(id,poseKind(slot)),poseKind(slot)).catch(()=>{});}
  async maintain(){
    for(const job of await this.model.expired()){
      // Crash recovery fails/refunds instead of issuing a second paid AI request.
      const failed=await this.model.finish(job.id,job.lease_token??'',null,'NXDUET_PREPARATION_INTERRUPTED',true);
      if(failed)await this.removeAll(job.id);
    }
    for(const row of await this.model.cleanupRows()){
      let source=false,overlay=false;
      if(row.source_path){await this.files.remove(row.id,row.source_path,'source');source=true;}
      if(row.deleted_at&&row.overlay_path){
        for(const pose of await this.model.poses(row.id))await this.files.remove(row.id,pose.overlay_path,poseKind(pose.slot));
        // Legacy single-pose templates keep their original asset path.
        if(row.overlay_path===this.files.path(row.id,'overlay'))await this.files.remove(row.id,row.overlay_path,'overlay');
        overlay=true;
      }
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

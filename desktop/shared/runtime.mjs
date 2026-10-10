import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { newId } from './journal.mjs';
import { inspectImage } from './image.mjs';
import { ControlClient, MediaClient } from './clients.mjs';

export class Runtime {
  constructor({journal,bridge,assets,origins,apiKey='',secrets,onChange=()=>{}}) {
    Object.assign(this,{journal,bridge,assets,origins,apiKey,secrets,onChange});
    this.session=journal.all().find(s=>s.phase!=='FINISHED')||null;this.busy=false;
    this.catalog={CLASSIC:[],BASIC:[],ADVANCED:[]};this.device={camera:'UNKNOWN',printer:'UNKNOWN'};
  }
  async initialize() {
    try{this.device=await this.bridge.call('devices.status');}catch{this.device={camera:'ADAPTER_UNAVAILABLE',printer:'ADAPTER_UNAVAILABLE',simulated:false};}
    if(this.apiKey)try { const c=new ControlClient(this.origins,this.apiKey);
      const [frames,templates,experiences]=await Promise.all([c.catalog('frames'),c.catalog('templates'),c.catalog('experiences')]);
      this.catalog={CLASSIC:frames.map(f=>({id:f.id,name:f.name,shots:f.shot_count})),BASIC:templates.map(t=>({id:t.id,name:t.name,shots:1})),ADVANCED:experiences.map(e=>({id:e.id,name:e.name,shots:1}))};
    }catch{this.connectionError='CATALOG_UNAVAILABLE';}
    return this.state();
  }
  async state() {
    const s=this.session; const previews=[];
    if(s) for(const c of s.captures) {const bytes=await readFile(join(this.assets,c.file));const {mime}=inspectImage(bytes);previews.push({id:c.id,url:`data:${mime};base64,${bytes.toString('base64')}`});}
    let result=null;
    if(s?.resultFile){const b=await readFile(join(this.assets,s.resultFile));result=`data:${inspectImage(b).mime};base64,${b.toString('base64')}`;}
    return {configured:!!this.apiKey,credentialPersistence:this.secrets.persistent,device:this.device,busy:this.busy,catalog:this.catalog,connectionError:this.connectionError,
      session:s?{id:s.id,phase:s.phase,mode:s.mode,shots:s.shots,captures:previews,result,error:s.error,jobStatus:s.jobStatus,prints:this.journal.prints(s.id)}:null};
  }
  async exclusive(fn){if(this.busy)throw new Error('OPERATION_BUSY');this.busy=true;this.onChange();try{return await fn();}finally{this.busy=false;this.onChange();}}
  async save(){await this.journal.save(this.session);this.onChange();}
  async setFixture(path){await this.bridge.call('camera.setFixture',{path});this.device=await this.bridge.call('devices.status');return this.state();}
  async start(mode,selectionId){return this.exclusive(async()=>{
    if(this.session && this.session.phase!=='FINISHED')throw new Error('SESSION_ACTIVE');
    const choice=this.catalog[mode]?.find(x=>x.id===selectionId);
    if(!['CLASSIC','BASIC','ADVANCED'].includes(mode)||this.apiKey&&!choice)throw new Error('SELECTION_REQUIRED');
    this.session={id:newId(),mode,selectionId:choice?.id||null,shots:choice?.shots||(mode==='CLASSIC'?3:1),phase:'CAPTURING',captures:[],keys:{reserve:newId(),upload:newId(),generate:newId()}};
    await this.save();return this.state();
  });}
  async capture(){return this.exclusive(async()=>{
    const s=this.session;if(!s||s.phase!=='CAPTURING'||s.captures.length>=s.shots)throw new Error('CAPTURE_NOT_ALLOWED');
    const id=newId();const result=await this.bridge.call('camera.capture',{captureId:id});
    const file=id+(result.path.endsWith('.png')?'.png':'.jpg');
    // Only accept the predetermined asset path; never trust a process-provided arbitrary path.
    if(result.path!==join(this.assets,file))throw new Error('CAPTURE_PATH_INVALID');
    const info=inspectImage(await readFile(result.path));s.captures.push({id,file,...info,simulated:result.simulated});
    if(s.captures.length===s.shots)s.phase='REVIEWING';await this.save();return this.state();
  });}
  async retake(){return this.exclusive(async()=>{const s=this.session;if(!s||!['CAPTURING','REVIEWING'].includes(s.phase)||!s.captures.length)throw new Error('RETAKE_NOT_ALLOWED');s.captures.pop();s.phase='CAPTURING';await this.save();return this.state();});}
  async process(){return this.exclusive(async()=>{
    const s=this.session;if(!s||!['REVIEWING','RECOVERY_REQUIRED','FAILED'].includes(s.phase))throw new Error('PROCESS_NOT_ALLOWED');
    if(!this.apiKey)throw new Error('BACKEND_NOT_CONFIGURED');
    if(!s.selectionId)throw new Error('SELECTION_REQUIRED');
    try{
      let secret=await this.secrets.get(s.id);
      if(!secret){if(s.remote||s.phase==='RECOVERY_REQUIRED')throw new Error('CREDENTIAL_RECOVERY_REQUIRED');secret={token:randomBytes(32).toString('base64url')};await this.secrets.set(s.id,secret);}
      const control=new ControlClient(this.origins,this.apiKey,secret.cookie||'',async cookie=>{secret.cookie=cookie;await this.secrets.set(s.id,secret);});
      const media=new MediaClient(this.origins,this.apiKey);
      s.phase='UPLOADING';s.error=null;await this.save();
      if(!s.remote){s.remote=await control.reserve({claimToken:secret.token},s.keys.reserve);await this.save();}
      if(!s.photoIds){const captures=[];for(const c of s.captures){const bytes=await readFile(join(this.assets,c.file));if(inspectImage(bytes).sha256!==c.sha256)throw new Error('CAPTURE_CHANGED');captures.push({id:c.id,bytes});}
        const upload=await media.upload(s.remote.uploadPath,captures,secret.token,s.keys.upload);s.photoIds=upload.photos.map(p=>p.id);await this.save();}
      if(!secret.cookie){await control.claim(s.remote.code,secret.token);if(!secret.cookie)throw new Error('CLAIM_COOKIE_MISSING');}
      if(!s.job){const selection=s.mode==='CLASSIC'?{frameId:s.selectionId}:s.mode==='BASIC'?{templateId:s.selectionId}:{experienceId:s.selectionId};
        s.job=await control.generate({sessionCode:s.remote.code,mode:s.mode,photoIds:s.photoIds,...selection},s.keys.generate);await this.save();}
      s.phase='PROCESSING';s.jobStatus=s.job.status;await this.save();
      // Poll only real backend states; leave slow work resumable after five minutes.
      for(let i=0;i<150;i++){
        const job=await control.status(s.job.id);s.jobStatus=job.status;await this.save();
        if(job.status==='FAILED')throw new Error('GENERATION_FAILED');
        if(job.status==='COMPLETED'){
          if(!job.resultId)throw new Error('RESULT_MISSING');
          const delivery=await control.resultUrl(job.resultId);const bytes=await media.download(delivery.url,secret.cookie);
          const info=inspectImage(bytes);s.resultFile=newId()+(info.mime==='image/png'?'.png':'.jpg');await writeFile(join(this.assets,s.resultFile),bytes,{flag:'wx',mode:0o600});
          s.resultHash=info.sha256;s.phase='RESULT_READY';await this.save();return this.state();
        }
        if(!['QUEUED','PROCESSING'].includes(job.status))throw new Error('JOB_STATUS_INVALID');
        await new Promise(resolve=>setTimeout(resolve,2000));
      }
      throw new Error('PROCESSING_TIMEOUT');
    }catch(e){s.error=/^[A-Z0-9_]+$/.test(e.message)?e.message:'CONNECTION_FAILED';s.phase=s.error==='GENERATION_FAILED'?'FAILED':'RECOVERY_REQUIRED';await this.save();throw new Error(s.error);}
  });}
  async print(){return this.exclusive(async()=>{const s=this.session;if(!s||s.phase!=='RESULT_READY')throw new Error('RESULT_REQUIRED');if(this.journal.prints(s.id).length)throw new Error('PRINT_ALREADY_SUBMITTED');
    if(inspectImage(await readFile(join(this.assets,s.resultFile))).sha256!==s.resultHash)throw new Error('RESULT_CHANGED');
    const id=newId();await this.journal.print(id,s.id,'SUBMITTING');
    try{const r=await this.bridge.call('printer.submit',{jobId:id,path:join(this.assets,s.resultFile)});if(r.status!=='SIMULATED')throw new Error('PRINT_STATUS_UNSUPPORTED');await this.journal.print(id,s.id,'SIMULATED');}
    catch(e){await this.journal.print(id,s.id,'UNKNOWN');throw e;}return this.state();
  });}
  async finish(){return this.exclusive(async()=>{if(!this.session)throw new Error('SESSION_REQUIRED');this.session.phase='FINISHED';await this.save();this.session=null;return this.state();});}
}

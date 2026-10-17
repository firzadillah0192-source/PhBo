import {mkdir,readFile,writeFile,appendFile,rename,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

const ACTION=/^(app|ipc|adapter|camera|renderer|ui|network)\.[A-Za-z0-9_.-]{1,72}$/;
const CODE=/^[A-Z][A-Z0-9_]{0,79}$/;
const REPEATED=/^(ipc\.(state|thumbnail|cameraFrame)|adapter\.camera\.frame|camera\.preview\.frame|network\.(generation\.poll|login\.poll))$/;
/** Pick scalars explicitly. Callers must never pass action parameters, results, exception messages, paths or image data. */
export function activityEvent(input,now=Date.now()){
 if(!Number.isFinite(now))return null;
 if(!input||!ACTION.test(input.action)||!['begin','ok','error','empty','summary'].includes(input.status))return null;
 const out={t:new Date(now).toISOString(),a:input.action,s:input.status};
 if(CODE.test(input.code||''))out.c=input.code;
 for(const key of ['ms','bytes','count','http'])if(Number.isSafeInteger(input[key])&&input[key]>=0&&input[key]<=1e9)out[key]=input[key];
 if(typeof input.sdk==='string'&&/^[A-Za-z0-9_.-]{1,64}$/.test(input.sdk))out.sdk=input.sdk;
 if(typeof input.exception==='string'&&/^[A-Za-z0-9_.]{1,80}$/.test(input.exception))out.ex=input.exception;
 if(/^0x[0-9A-Fa-f]{8}$/.test(input.hresult||''))out.hr=input.hresult;
 return out;
}
export class ActivityLog{
 constructor({dir,send,now=Date.now,intervalMs=15000,minSendMs=12000,maxDailyBytes=1500000}){
  Object.assign(this,{dir,send,now,intervalMs,minSendMs,maxDailyBytes});this.queue=[];this.samples=new Map();this.chain=Promise.resolve();this.lastSend=-Infinity;this.failures=0;this.retryAt=0;this.boot=randomUUID();this.sequence=0;this.used=0;this.day='';
 }
 async init(){
  await mkdir(this.dir,{recursive:true});
  try{
   const saved=JSON.parse(await readFile(join(this.dir,'activity-queue.json'),'utf8'));
   this.dropped=Math.max(0,Number(saved.dropped)||0);
   this.queue=(saved.events||[]).slice(-512).map(e=>activityEvent({action:e.a,status:e.s,code:e.c,ms:e.ms,bytes:e.bytes,count:e.count,http:e.http,sdk:e.sdk,exception:e.ex,hresult:e.hr},Date.parse(e.t))).filter(Boolean);
   if(saved.day===new Date(this.now()).toISOString().slice(0,10)){this.day=saved.day;this.used=Math.min(this.maxDailyBytes,Math.max(0,Number(saved.used)||0));}
  }catch{}
 }
 start(){this.timer=setInterval(()=>{this.summarize();void this.flush();},this.intervalMs);this.timer.unref?.();}
 record(input){
  const event=activityEvent(input,this.now());if(!event)return;
  const frequent=REPEATED.test(input.action);
  // First frame/error is immediate. Further identical polling results become counts once per minute.
  if(frequent){
   const key=event.a+':'+event.s+':'+(event.c||'')+':'+(event.sdk||'');const sample=this.samples.get(key);
   if(sample){sample.count++;sample.last=event;return;}
   this.samples.set(key,{count:0,last:event,since:this.now()});
  }
  this.enqueue(event);
 }
 summarize(force=false){for(const [key,sample] of this.samples){if(force||this.now()-sample.since>=60000){if(sample.count)this.enqueue({...sample.last,s:'summary',count:sample.count});this.samples.delete(key);}}}
 enqueue(event){
  if(this.queue.length>=512){this.queue.shift();this.dropped=(this.dropped||0)+1;}this.queue.push(event);
  this.chain=this.chain.then(async()=>{
   const file=join(this.dir,'activity.jsonl');
   if(await stat(file).then(s=>s.size,()=>0)>512*1024)await rename(file,join(this.dir,'activity.previous.jsonl'));
   await appendFile(file,JSON.stringify(event)+'\n',{mode:0o600});await this.persist();
  }).catch(()=>{this.localError='ACTIVITY_LOG_WRITE_FAILED';});
 }
 async persist(){
  const file=join(this.dir,'activity-queue.json');await writeFile(file+'.tmp',JSON.stringify({day:this.day,used:this.used,dropped:this.dropped||0,events:this.queue}),{mode:0o600});await rename(file+'.tmp',file);
 }
 async flush(){
  if(this.sending)return null;
  const now=this.now();if(now<this.retryAt||now-this.lastSend<this.minSendMs)return null;
  this.sending=true;
  try{
   await this.chain;if(!this.queue.length)return null;
   const day=new Date(now).toISOString().slice(0,10);if(day!==this.day){this.day=day;this.used=0;}
   const batch=[];let text='';for(const e of this.queue){const line=JSON.stringify(e)+'\n';if(text.length+line.length>1900)break;batch.push(e);text+=line;}
   if(!batch.length)return null;
   if(this.used+text.length+600>this.maxDailyBytes){this.lastError='ACTIVITY_DAILY_LIMIT';return null;}
   this.lastSend=now;
   const result=await this.send(text,`activity/v1 boot=${this.boot} batch=${++this.sequence} dropped=${this.dropped||0}`);
   const sent=new Set(batch);this.queue=this.queue.filter(e=>!sent.has(e));this.used+=text.length+600;this.failures=0;this.retryAt=0;this.lastError='';this.lastDelivered=new Date(now).toISOString();
   this.chain=this.chain.then(()=>this.persist()).catch(()=>{this.localError='ACTIVITY_LOG_WRITE_FAILED';});await this.chain;return result;
  }catch(e){this.failures++;this.lastError=CODE.test(e?.message||'')?e.message:'ACTIVITY_UPLOAD_FAILED';this.retryAt=this.now()+Math.min(120000,15000*2**Math.min(this.failures-1,3));return null;}
  finally{this.sending=false;}
 }
 status(){return {queued:this.queue.length,dropped:this.dropped||0,lastDelivered:this.lastDelivered||null,error:this.lastError||this.localError||null};}
 async stop(){clearInterval(this.timer);this.summarize(true);await this.chain;}
}

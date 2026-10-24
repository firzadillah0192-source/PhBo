import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import {GenerationWebhookModel} from '../models/generation-webhook.model.js';
import {sendWebhook,WebhookVault,webhookUrl,webhookSignature} from './webhook-security.js';
const input=z.object({url:z.string().max(2048).transform(webhookUrl),enabled:z.boolean(),events:z.array(z.enum(['generation.completed','generation.failed'])).min(1).max(2).transform(a=>[...new Set(a)])}).strict();
const ident=z.string().regex(/^[a-f0-9]{16}$/),deliveryId=z.string().regex(/^[a-f0-9]{32}$/);
export class GenerationWebhookService{
 constructor(readonly model:GenerationWebhookModel,private vault:WebhookVault,private send=sendWebhook){}
 view(e:Awaited<ReturnType<GenerationWebhookModel['endpoint']>>){return e?{id:e.id,key_id:e.key_id,url:e.url,enabled:e.enabled,events:e.events,version:e.version,created_at:e.created_at,updated_at:e.updated_at}:null;}
 async get(account:string,key:string){return {webhook:this.view(await this.model.endpoint(account,ident.parse(key)))};}
 async save(account:string,key:string,body:unknown){key=ident.parse(key);const data=input.parse(body),secret='nxb_whsec_'+randomBytes(32).toString('base64url'),id=randomBytes(16).toString('hex');const saved=await this.model.save(account,key,data,{id,encrypted:this.vault.encrypt(secret,id)});return {webhook:this.view(saved.endpoint),...(saved.created?{signing_secret:secret}:{})};}
 async rotate(account:string,key:string){const secret='nxb_whsec_'+randomBytes(32).toString('base64url');await this.model.rotate(account,ident.parse(key),id=>this.vault.encrypt(secret,id));return {signing_secret:secret};}
 async history(account:string,key:string,query:unknown){const q=z.object({cursor:deliveryId.optional(),state:z.enum(['PENDING','IN_FLIGHT','DELIVERED','EXHAUSTED','CANCELLED']).optional(),_request:z.string().optional()}).strict().parse(query);const rows=await this.model.history(account,ident.parse(key),q.cursor??null,q.state??null);return {deliveries:rows.slice(0,20),next_cursor:rows.length>20?rows[19]!.id:null};}
 async attempts(account:string,key:string,id:string){return {attempts:await this.model.attempts(account,ident.parse(key),deliveryId.parse(id))};}
 async retry(account:string,key:string,id:string){await this.model.retry(account,ident.parse(key),deliveryId.parse(id));return {queued:true};}
 async dispatchOne(){const d=await this.model.claim();if(!d)return false;const e=await this.model.credential(d);if(!e){await this.model.cancel(d);return true;}const start=Date.now();let result;try{const secret=this.vault.decrypt(e.encrypted_secret,e.id),ts=String(Math.floor(Date.now()/1000));result=await this.send(d.target_url,d.payload,{'X-NXBooth-Event-Id':d.id,'X-NXBooth-Timestamp':ts,'X-NXBooth-Signature':webhookSignature(secret,ts,d.payload)});}catch{result={status:null,error:'CREDENTIAL_UNAVAILABLE'};}await this.model.finish(d,result.status,result.error,Date.now()-start);return true;}
 // Independent bounded dispatcher: never blocks generation. Fixed safe logs, no remote response bodies.
 async run(signal:AbortSignal){let cleanupAt=0;while(!signal.aborted){try{if(Date.now()>=cleanupAt){await this.model.cleanup();cleanupAt=Date.now()+3600000;}if(await this.dispatchOne())continue;}catch{console.error('Webhook dispatch failed; durable delivery will retry');}await new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();},timer=setTimeout(done,1000);signal.addEventListener('abort',done,{once:true});if(signal.aborted)done();});}}
}

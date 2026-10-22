import {createCipheriv,createDecipheriv,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {isIP} from 'node:net';
import {lookup} from 'node:dns/promises';
import https from 'node:https';
import {AppError} from '../lib/errors.js';
const invalid=()=>new AppError(422,'WEBHOOK_URL_INVALID','Use a public HTTPS URL without credentials, query, fragment or custom port.');
export function webhookUrl(raw:string){
 let u:URL;try{u=new URL(raw);}catch{throw invalid();}
 if(raw.length>2048||u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.port||isIP(u.hostname.replace(/^\[|\]$/g,''))||!u.hostname.includes('.')||/(^|\.)(localhost|local|internal|localdomain)$/.test(u.hostname))throw invalid();
 return u.toString();
}
// Conservative global-unicast allowlist: blocks special-use, mapped, transition and documentation ranges.
export function webhookPublicAddress(ip:string):boolean{
 if(isIP(ip)===4){const [a,b,c]=ip.split('.').map(Number) as [number,number,number];return !(a===0||a===10||a===127||a>=224||a===100&&b>=64&&b<=127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===88&&c===99)||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);}
 if(isIP(ip)===6){const parts=ip.split(':'),h=parseInt(parts[0]!,16),second=parseInt(parts[1]||'0',16);return h>=0x2000&&h<=0x3fff&&!(h===0x2001&&(second<=0x1ff||second===0xdb8))&&h!==0x2002&&h!==0x3ffe&&h!==0x3fff;}
 return false;
}
export class WebhookVault{
 private keys:Record<string,Buffer>={};
 constructor(readonly active:string,keyring:string){let parsed:Record<string,string>;try{parsed=JSON.parse(keyring);}catch{throw new Error('Invalid webhook encryption keyring');}for(const [version,key]of Object.entries(parsed)){if(!/^[A-Za-z0-9_-]{1,30}$/.test(version)||!/^[a-f0-9]{64}$/i.test(key))throw new Error('Invalid webhook encryption keyring');this.keys[version]=Buffer.from(key,'hex');}if(!this.keys[active])throw new Error('Missing active webhook encryption key');}
 encrypt(plain:string,context:string){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',this.keys[this.active]!,iv);c.setAAD(Buffer.from(context));const body=Buffer.concat([c.update(plain,'utf8'),c.final()]);return [this.active,iv.toString('base64url'),c.getAuthTag().toString('base64url'),body.toString('base64url')].join('.');}
 decrypt(blob:string,context:string){try{const [v,iv,tag,body]=blob.split('.');const c=createDecipheriv('aes-256-gcm',this.keys[v!]!,Buffer.from(iv!,'base64url'));c.setAAD(Buffer.from(context));c.setAuthTag(Buffer.from(tag!,'base64url'));return Buffer.concat([c.update(Buffer.from(body!,'base64url')),c.final()]).toString('utf8');}catch{throw new Error('Webhook credential unavailable');}}
}
export const webhookSignature=(secret:string,timestamp:string,body:string)=>'v1='+createHmac('sha256',secret).update(timestamp+'.'+body).digest('hex');
export function verifyWebhook(secret:string,timestamp:string,body:string,signature:string,now=Date.now()){if(!/^\d{10,}$/.test(timestamp)||Math.abs(now/1000-Number(timestamp))>300)return false;const expected=Buffer.from(webhookSignature(secret,timestamp,body)),actual=Buffer.from(signature);return expected.length===actual.length&&timingSafeEqual(expected,actual);}
export type WebhookResponse={status:number|null;error:string|null};
type TransportDeps={resolve?:(hostname:string)=>Promise<{address:string;family:number}[]>;request?:typeof https.request;timeoutMs?:number};
export async function sendWebhook(raw:string,body:string,headers:Record<string,string>,deps:TransportDeps={}):Promise<WebhookResponse>{
 try{
  const u=new URL(webhookUrl(raw));const addresses=await Promise.race([(deps.resolve?deps.resolve(u.hostname):lookup(u.hostname,{all:true})),new Promise<never>((_,reject)=>{const t=setTimeout(()=>reject(new Error('DNS_TIMEOUT')),3000);t.unref();})]);
  if(!addresses.length||addresses.some(a=>!webhookPublicAddress(a.address)))return {status:null,error:'DESTINATION_BLOCKED'};
  const pinned=addresses[0]!;
  return await new Promise(resolve=>{let finished=false;const finish=(r:WebhookResponse)=>{if(finished)return;finished=true;clearTimeout(timer);resolve(r);};
   const req=(deps.request??https.request)(u,{method:'POST',agent:false,family:pinned.family,lookup:(_host,_options,cb)=>cb(null,pinned.address,pinned.family),headers:{...headers,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'User-Agent':'NXBooth-Webhooks/1'}},res=>{const status=res.statusCode??0;finish({status,error:status>=200&&status<300?null:'HTTP_ERROR'});res.destroy();});
   const timer=setTimeout(()=>{finish({status:null,error:'TIMEOUT'});req.destroy();},deps.timeoutMs??7000);req.on('error',()=>finish({status:null,error:'NETWORK_ERROR'}));req.end(body);
  });
 }catch{return {status:null,error:'DESTINATION_BLOCKED'};}
}

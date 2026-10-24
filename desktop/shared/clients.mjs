import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { once } from 'node:events';
import { inspectImage } from './image.mjs';
let networkObserver=()=>{};
export function observeNetwork(observer){networkObserver=observer||(()=>{});}
async function tracedFetch(url,options){
 const path=new URL(url).pathname;
 // Never log URLs, IDs, upload/claim tokens, headers or request/response bodies.
 const action=path==='/api/v1/desktop/diagnostics'?null:path.endsWith('/desktop/device/code')?'network.login.start':path.endsWith('/desktop/device/token')?'network.login.poll':path.includes('/desktop/update')?'network.update':path.endsWith('/upload')?'network.photo.upload':path.includes('/photo-sessions/')?'network.session.claim':path.endsWith('/kiosk/sessions')?'network.session.reserve':path==='/api/v1/generations'?'network.generation.create':path.startsWith('/api/v1/generations/')?'network.generation.poll':path.endsWith('/claim')?'network.result.claim':path.startsWith('/api/v1/results/')?'network.result':/^\/api\/v1\/(frames|templates|experiences)/.test(path)?'network.catalog':'network.image';
 const started=Date.now();const emit=record=>{if(action)try{networkObserver({action,...record});}catch{}};
 emit({status:'begin'});
 try{const response=await fetch(url,options);emit({status:response.ok?'ok':'error',code:response.ok?undefined:'HTTP_'+response.status,http:response.status,ms:Date.now()-started});return response;}
 catch(e){emit({status:'error',code:['TimeoutError','AbortError'].includes(e?.name)?'NETWORK_TIMEOUT':'NETWORK_FAILED',ms:Date.now()-started});throw e;}
}
const defaults = {control:'https://api-nxbooth.gennexbyte.com',media:'https://media-nxbooth.gennexbyte.com',storage:'https://storage-nxbooth.gennexbyte.com',web:'https://nxbooth.gennexbyte.com'};
const segment = value => { if(typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new Error('INVALID_ID'); return value; };
/** Kiosk credential: a device token `{token}` (account login) or the legacy shared key string. */
export const authHeaders=credential=>credential&&typeof credential==='object'?{Authorization:'Bearer '+credential.token}:credential?{'X-API-Key':credential}:{};
export function origins(config={}, test=false) {
  const result={...defaults,...config};
  for(const value of Object.values(result)) { const u=new URL(value); if(u.username||u.password||u.search||u.hash||u.pathname!=='/' || !(u.protocol==='https:' || test&&u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname))) throw new Error('INVALID_ORIGIN'); }
  return result;
}
async function bounded(response, maximum) {
  const chunks=[];let size=0;
  if(Number(response.headers.get('content-length'))>maximum) throw new Error('RESPONSE_TOO_LARGE');
  for await(const chunk of response.body) { size+=chunk.length; if(size>maximum) {await response.body.cancel().catch(()=>{});throw new Error('RESPONSE_TOO_LARGE');} chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function json(response) {
  if(!response.headers.get('content-type')?.includes('application/json')) throw new Error('BACKEND_RESPONSE_INVALID');
  const body=JSON.parse((await bounded(response,1024*1024)).toString());
  if(!response.ok) throw new Error(/^[A-Z0-9_]+$/.test(body.error?.code||'') ? body.error.code : 'BACKEND_REQUEST_FAILED');
  return body.data;
}
function jsonOnly(value) {
  if(value===null || ['string','number','boolean'].includes(typeof value)) return;
  if(typeof value!=='object'||Buffer.isBuffer(value)||ArrayBuffer.isView(value)||value instanceof ArrayBuffer) throw new Error('CONTROL_JSON_ONLY');
  for(const [key,v] of Object.entries(value)) {if(/^(bytes|base64|image|file|photo)$/i.test(key))throw new Error('CONTROL_JSON_ONLY'); jsonOnly(v);}
}
export class ControlClient {
  constructor(config,apiKey='',cookie='',persistCookie=async()=>{}) {this.config=config;this.apiKey=apiKey;this.cookie=cookie;this.persistCookie=persistCookie;}
  async request(path,body, key) {
    if(!/^\/api\/v1\/(kiosk\/sessions|photo-sessions\/[a-zA-Z0-9_-]+\/claim|generations(?:\/[a-zA-Z0-9_-]+)?|results\/[a-zA-Z0-9_-]+(?:\/url|\/claim)?|frames|templates|experiences)$/.test(path)) throw new Error('CONTROL_ROUTE_FORBIDDEN');
    const headers={'Accept':'application/json','User-Agent':'NXBoothDesktop/1.0'};
    Object.assign(headers,authHeaders(this.apiKey));if(this.cookie)headers.Cookie=this.cookie;if(key)headers['Idempotency-Key']=key;
    if(body!==undefined){jsonOnly(body);headers['Content-Type']='application/json';}
    const r=await tracedFetch(this.config.control+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(30000)});
    // Store access credential before parsing the response body.
    const cookie=r.headers.get('set-cookie')?.match(/(?:^|\s)(photo_session=[A-Za-z0-9_-]{43})(?:;|$)/)?.[1];
    if(cookie){await this.persistCookie(cookie);this.cookie=cookie;}
    return json(r);
  }
  reserve(body,key){return this.request('/api/v1/kiosk/sessions',body,key);}
  claim(code,token){return this.request(`/api/v1/photo-sessions/${segment(code)}/claim`,{token});}
  generate(body,key){return this.request('/api/v1/generations',body,key);}
  status(id){return this.request(`/api/v1/generations/${segment(id)}`);}
  resultUrl(id){return this.request(`/api/v1/results/${segment(id)}/url`);}
  /** QR link for the finished photo (same kiosk session cookie as the result URL). Only a link on our own web origin is accepted. */
  async claimResult(id){
    const claim=await this.request(`/api/v1/results/${segment(id)}/claim`,{refresh:false});
    let url;try{url=new URL(claim.claim_url);}catch{throw new Error('CLAIM_INVALID');}
    if(url.origin!==this.config.web||url.username||url.password||url.search||url.hash||!/^\/r\/[A-Za-z0-9_-]{32,256}$/.test(url.pathname)||claim.qr_payload!==claim.claim_url)throw new Error('CLAIM_INVALID');
    return {url:claim.qr_payload,expires_at:typeof claim.expires_at==='string'?claim.expires_at:null};
  }
  catalog(kind){if(!['frames','templates','experiences'].includes(kind))throw new Error('INVALID_CATALOG');return this.request('/api/v1/'+kind);}
}
const CATALOG_IMAGE=/^\/api\/(templates\/[a-zA-Z0-9_-]+\/preview|experiences\/[a-zA-Z0-9_-]+\/thumbnail|classic\/layouts\/[a-zA-Z0-9_-]+\/preview)$/;
/** Public catalog artwork only: fixed web origin, allowlisted paths, no cookies, no redirects. */
export async function fetchCatalogImage(config,path){
  if(typeof path!=='string'||!CATALOG_IMAGE.test(path))throw new Error('CATALOG_IMAGE_FORBIDDEN');
  const r=await tracedFetch(config.web+path,{headers:{'Accept':'image/png,image/jpeg,image/webp','User-Agent':'NXBoothDesktop/1.0'},redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw new Error('CATALOG_IMAGE_FAILED');
  return bounded(r,8*1024*1024);
}
export class MediaClient {
  constructor(config,apiKey=''){this.config=config;this.apiKey=apiKey;}
  async upload(path,captures,token,key) {
    if(!/^\/api\/v1\/kiosk\/session\/[a-zA-Z0-9_-]+\/upload$/.test(path)) throw new Error('MEDIA_ROUTE_FORBIDDEN');
    const form=new FormData();
    for(const {id,bytes} of captures){const {mime}=inspectImage(bytes);form.append('image',new Blob([bytes],{type:mime}),segment(id)+(mime==='image/png'?'.png':'.jpg'));}
    const r=await tracedFetch(this.config.media+path,{method:'POST',headers:{...authHeaders(this.apiKey),'X-Kiosk-Upload-Token':token,'Idempotency-Key':key,'Accept':'application/json','User-Agent':'NXBoothDesktop/1.0'},body:form,redirect:'error',signal:AbortSignal.timeout(120000)});
    return json(r);
  }
  async download(location,cookie='') {
    const u=new URL(location,this.config.media);
    if(u.username||u.password||u.hash||![this.config.storage,this.config.media].includes(u.origin))throw new Error('MEDIA_ORIGIN_FORBIDDEN');
    if(u.origin===this.config.media && !/^\/api\/v1\/results\/[a-zA-Z0-9_-]+\/(image|download)$/.test(u.pathname))throw new Error('MEDIA_ROUTE_FORBIDDEN');
    const headers={'User-Agent':'NXBoothDesktop/1.0','Accept':'image/png,image/jpeg'};
    if(u.origin===this.config.media && cookie)headers.Cookie=cookie;
    const r=await tracedFetch(u,{headers,redirect:'error',signal:AbortSignal.timeout(60000)});
    if(!r.ok)throw new Error('MEDIA_DOWNLOAD_FAILED');
    const bytes=await bounded(r,16*1024*1024);inspectImage(bytes);return bytes;
  }
}
/** Desktop self-update. Same kiosk key as other kiosk calls; installer bytes use the media origin. */
export class UpdateClient {
  constructor(config,apiKey=''){this.config=config;this.apiKey=apiKey;}
  headers(){return {...authHeaders(this.apiKey),'Accept':'application/json','User-Agent':'NXBoothDesktop/1.0'};}
  async check(current) {
    if(!this.apiKey)throw new Error('BACKEND_NOT_CONFIGURED');
    if(!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(current))throw new Error('INVALID_VERSION');
    const r=await tracedFetch(this.config.control+'/api/v1/desktop/update?current='+current,{headers:this.headers(),redirect:'error',signal:AbortSignal.timeout(30000)});
    return json(r);
  }
  async download(info,file,onProgress=()=>{}) {
    if(!this.apiKey)throw new Error('BACKEND_NOT_CONFIGURED');
    if(!Number.isInteger(info?.size)||info.size<=0||info.size>500*1024*1024||!/^[a-f0-9]{64}$/.test(info.sha256||''))throw new Error('UPDATE_MANIFEST_INVALID');
    const r=await tracedFetch(this.config.media+'/api/v1/desktop/update/download',{headers:this.headers(),redirect:'error',signal:AbortSignal.timeout(600000)});
    if(!r.ok||!r.body)throw new Error('UPDATE_DOWNLOAD_FAILED');
    if(Number(r.headers.get('content-length'))!==info.size)throw new Error('UPDATE_SIZE_MISMATCH');
    const hash=createHash('sha256'),out=createWriteStream(file,{flags:'wx',mode:0o600});let size=0;
    // Keep asynchronous file errors handled even while waiting for the next network chunk.
    let writeError;out.on('error',error=>{writeError=error;});
    try {
      onProgress(0,info.size);
      for await(const chunk of r.body) {
        if(writeError)throw writeError;
        size+=chunk.length;if(size>info.size)throw new Error('UPDATE_SIZE_MISMATCH');
        hash.update(chunk);if(!out.write(chunk))await once(out,'drain');
        onProgress(size,info.size);
      }
      if(writeError)throw writeError;
      await new Promise((resolve,reject)=>out.end(e=>e?reject(e):resolve()));
    } catch(error) {out.destroy();await rm(file,{force:true});throw error;}
    if(size!==info.size||hash.digest('hex')!==info.sha256){await rm(file,{force:true});throw new Error('UPDATE_HASH_MISMATCH');}
  }
}
/** Device-code login endpoints (no credentials yet), through the control gateway. */
export class DeviceClient {
  constructor(config){this.config=config;}
  async post(path,body) {
    const r=await tracedFetch(this.config.control+path,{method:'POST',headers:{'Accept':'application/json','Content-Type':'application/json','User-Agent':'NXBoothDesktop/1.0'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(30000)});
    return json(r);
  }
  start(name){return this.post('/api/v1/desktop/device/code',{device_name:name});}
  poll(deviceCode){return this.post('/api/v1/desktop/device/token',{device_code:deviceCode});}
}
/** Support log: one JSON report per request, sent by an operator or bounded automatic activity batches, with the same kiosk credential as other kiosk calls. */
export class DiagnosticsClient {
  constructor(config,apiKey=''){this.config=config;this.apiKey=apiKey;}
  async send(report) {
    if(!this.apiKey)throw new Error('BACKEND_NOT_CONFIGURED');
    jsonOnly(report);
    const r=await tracedFetch(this.config.control+'/api/v1/desktop/diagnostics',{method:'POST',headers:{...authHeaders(this.apiKey),'Accept':'application/json','Content-Type':'application/json','User-Agent':'NXBoothDesktop/1.0'},body:JSON.stringify(report),redirect:'error',signal:AbortSignal.timeout(30000)});
    return json(r);
  }
}

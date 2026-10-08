import { inspectImage } from './image.mjs';
const defaults = {control:'https://api-nxbooth.gennexbyte.com',media:'https://media-nxbooth.gennexbyte.com',storage:'https://storage-nxbooth.gennexbyte.com'};
const segment = value => { if(typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new Error('INVALID_ID'); return value; };
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
    if(!/^\/api\/v1\/(kiosk\/sessions|photo-sessions\/[a-zA-Z0-9_-]+\/claim|generations(?:\/[a-zA-Z0-9_-]+)?|results\/[a-zA-Z0-9_-]+(?:\/url)?|frames|templates|experiences)$/.test(path)) throw new Error('CONTROL_ROUTE_FORBIDDEN');
    const headers={'Accept':'application/json','User-Agent':'NXBoothDesktop/1.0'};
    if(this.apiKey)headers['X-API-Key']=this.apiKey;if(this.cookie)headers.Cookie=this.cookie;if(key)headers['Idempotency-Key']=key;
    if(body!==undefined){jsonOnly(body);headers['Content-Type']='application/json';}
    const r=await fetch(this.config.control+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(30000)});
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
  catalog(kind){if(!['frames','templates','experiences'].includes(kind))throw new Error('INVALID_CATALOG');return this.request('/api/v1/'+kind);}
}
export class MediaClient {
  constructor(config,apiKey=''){this.config=config;this.apiKey=apiKey;}
  async upload(path,captures,token,key) {
    if(!/^\/api\/v1\/kiosk\/session\/[a-zA-Z0-9_-]+\/upload$/.test(path)) throw new Error('MEDIA_ROUTE_FORBIDDEN');
    const form=new FormData();
    for(const {id,bytes} of captures){const {mime}=inspectImage(bytes);form.append('image',new Blob([bytes],{type:mime}),segment(id)+(mime==='image/png'?'.png':'.jpg'));}
    const r=await fetch(this.config.media+path,{method:'POST',headers:{'X-API-Key':this.apiKey,'X-Kiosk-Upload-Token':token,'Idempotency-Key':key,'Accept':'application/json','User-Agent':'NXBoothDesktop/1.0'},body:form,redirect:'error',signal:AbortSignal.timeout(120000)});
    return json(r);
  }
  async download(location,cookie='') {
    const u=new URL(location,this.config.media);
    if(u.username||u.password||u.hash||![this.config.storage,this.config.media].includes(u.origin))throw new Error('MEDIA_ORIGIN_FORBIDDEN');
    if(u.origin===this.config.media && !/^\/api\/v1\/results\/[a-zA-Z0-9_-]+\/(image|download)$/.test(u.pathname))throw new Error('MEDIA_ROUTE_FORBIDDEN');
    const headers={'User-Agent':'NXBoothDesktop/1.0','Accept':'image/png,image/jpeg'};
    if(u.origin===this.config.media && cookie)headers.Cookie=cookie;
    const r=await fetch(u,{headers,redirect:'error',signal:AbortSignal.timeout(60000)});
    if(!r.ok)throw new Error('MEDIA_DOWNLOAD_FAILED');
    const bytes=await bounded(r,16*1024*1024);inspectImage(bytes);return bytes;
  }
}

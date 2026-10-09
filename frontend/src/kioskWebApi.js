import {generationRequestKey,associateGenerationRequest,settleGenerationRequest} from './generationRequest.js'
export async function kioskWebRequest(path,options={}){
 const response=await fetch('/api/kiosk'+path,{credentials:'include',cache:'no-store',...options});const body=await response.json().catch(()=>({}));
 if(!response.ok){const detail=body.detail||body;const error=new Error(detail.message||'Kiosk request failed');error.status=response.status;error.errorCode=detail.error_code||detail.code;if([401,403].includes(response.status)&&!['/access','/login/google'].includes(path))globalThis.window?.dispatchEvent(new CustomEvent('kiosk:access-lost',{detail:{status:response.status}}));throw error}return body
}
export const kioskGoogleLogin=id_token=>kioskWebRequest('/login/google',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id_token})})
export const kioskLogout=()=>kioskWebRequest('/logout',{method:'POST'})
export const getKioskAccess=()=>kioskWebRequest('/access')
export const getClassicLayouts=()=>kioskWebRequest('/web/classic/layouts')
export const getTemplates=()=>kioskWebRequest('/web/templates')
export const getExperiences=()=>kioskWebRequest('/web/experiences')
export const getFrameStyles=()=>kioskWebRequest('/web/advanced/frame-styles')
export const getUsage=()=>kioskWebRequest('/web/account/usage')
export const startKioskSession=()=>kioskWebRequest('/web/kiosk/session',{method:'POST'})
export function uploadPhoto(file){const body=new FormData();body.append('file',file);return kioskWebRequest('/web/uploads',{method:'POST',body})}
export async function createGeneration(uploadId,mode,templateId,experienceId,options={}){
 const body={upload_id:uploadId,mode,...mode==='CLASSIC'?{layout_id:options.layoutId,capture_upload_ids:options.captureUploadIds}:mode==='BASIC'?{template_id:templateId}:{experience_id:experienceId,frame_style_id:options.frameStyleId,ornament_ids:options.ornamentIds||[]}};
 const key=generationRequestKey(body);const job=await kioskWebRequest('/web/generations',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)});associateGenerationRequest(key,job.job_id);return job
}
export async function getGeneration(id){const job=await kioskWebRequest('/web/generations/'+encodeURIComponent(id));settleGenerationRequest(id,job.state);return job}
export const getResult=id=>kioskWebRequest('/web/results/'+encodeURIComponent(id))
export const resultImageUrl=id=>'/api/kiosk/web/results/'+encodeURIComponent(id)+'/image'
export const resultDownloadUrl=id=>'/api/kiosk/web/results/'+encodeURIComponent(id)+'/download'
export const createResultClaim=(id,reuseToken=null,refresh=false)=>kioskWebRequest('/web/results/'+encodeURIComponent(id)+'/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kiosk:true,...reuseToken?{reuse_token:reuseToken}:{},refresh})})

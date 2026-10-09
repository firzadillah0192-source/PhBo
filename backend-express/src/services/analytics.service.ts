import {PostHog} from 'posthog-node';
import type {Express,Request,Response,ErrorRequestHandler} from 'express';
import {AppError} from '../lib/errors.js';
let client:PostHog|null|undefined;
const terminal=new Set<string>();
export function analyticsRoute(path:string){return path.split('?')[0].replace(/\/(r|claim)\/[^/]+/g,'/$1/:token').replace(/\/(results|generations|uploads|sessions)\/[^/]+/g,'/$1/:id');}
export function safeAnalyticsEvent(event:any){
 const properties:Record<string,unknown>={app:'phbo'};
 const allowed=['app','surface','route','method','status','error_code','job_id','state','mode','is_test','$session_id','$lib','$lib_version','$geoip_disable','$process_person_profile'];
 for(const key of allowed){const value=event.properties?.[key];if(['string','number','boolean'].includes(typeof value))properties[key]=key==='route'?analyticsRoute(String(value)):value;}
 const exceptions=event.properties?.$exception_list;
 if(Array.isArray(exceptions))properties.$exception_list=exceptions.slice(0,3).map(e=>({type:/^[A-Za-z][\w.]{0,80}$/.test(e.type)?e.type:'Error',value:'Application exception (message redacted)',mechanism:e.mechanism?{type:e.mechanism.type,handled:e.mechanism.handled}:undefined,stacktrace:{frames:(e.stacktrace?.frames||[]).slice(-30).map((f:any)=>({filename:String(f.filename||'').split('?')[0],function:f.function,lineno:f.lineno,colno:f.colno,in_app:f.in_app}))}}));
 return {...event,properties};
}
export function backendAnalytics(){
 if(client!==undefined)return client;
 const token=process.env.POSTHOG_PROJECT_TOKEN,host=process.env.POSTHOG_HOST;
 if(!token||!host){if(process.env.NODE_ENV==='development')throw new Error('POSTHOG_PROJECT_TOKEN and POSTHOG_HOST required by PostHog are missing or un-configured.');return client=null;}
 client=new PostHog(token,{host,flushAt:10,flushInterval:1000,enableExceptionAutocapture:true,before_send:safeAnalyticsEvent});
 client.on('error',()=>console.warn('PhBo analytics delivery unavailable'));
 return client;
}
const safeId=(value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(value)?value:null;
export function installAnalytics(app:Express,sdk:Pick<PostHog,'capture'|'captureException'>|null=backendAnalytics()){
 if(!sdk)return;
 app.use((req:Request,res:Response,next)=>{
  const distinct=safeId(req.get('X-POSTHOG-DISTINCT-ID')),session=safeId(req.get('X-POSTHOG-SESSION-ID'));
  const send=res.json.bind(res);
  res.json=(body:any)=>{
   const sent=send(body);
   const accountId=body?.account?.id||(/\/account\/(login|signup|google)$/.test(req.path)?body?.id:null);
   const distinctId=safeId(body?.analytics_id)||(accountId?'phbo-account:'+accountId:distinct);
   if(!distinctId||!req.path.startsWith('/api/')||req.path.startsWith('/api/admin/'))return sent;
   const properties={surface:req.path.startsWith('/api/kiosk')?'kiosk':'web',route:analyticsRoute(req.path),method:req.method,status:res.statusCode,...session?{$session_id:session}:{}};
   try{
    if(!['GET','HEAD','OPTIONS'].includes(req.method))sdk.capture({distinctId,event:'phbo_api_request_finished',properties});
    if(req.method==='POST'&&req.path.endsWith('/generations')&&res.statusCode===202)sdk.capture({distinctId,event:'phbo_generation_queued',properties:{...properties,job_id:body.job_id,state:body.state}});
    if(req.method==='GET'&&/\/generations\/[^/]+$/.test(req.path)&&['COMPLETED','FAILED'].includes(body?.state)&&!terminal.has(body.job_id)){
     if(terminal.size>2000)terminal.clear();terminal.add(body.job_id);sdk.capture({distinctId,event:'phbo_generation_status_'+body.state.toLowerCase(),properties:{...properties,job_id:body.job_id,state:body.state}});
    }
   }catch{}
   return sent;
  };
  next();
 });
 const errorCapture:ErrorRequestHandler=(error,req,_res,next)=>{
  if(error instanceof AppError&&error.status<500){next(error);return;}
  const distinctId=safeId(req.get('X-POSTHOG-DISTINCT-ID'));
  if(distinctId)try{sdk.captureException(error,distinctId,{app:'phbo',route:analyticsRoute(req.path),method:req.method})}catch{}
  next(error);
 };
 app.locals.posthogErrorCapture=errorCapture;
}
export async function shutdownAnalytics(){if(client)await client.shutdown(3000).catch(()=>{});}

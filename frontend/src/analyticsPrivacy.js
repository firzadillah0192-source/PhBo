const keys=new Set(['distinct_id','app','surface','mode','shot_count','pose_index','retakes_remaining','status','error_code','template_id','experience_id','layout_id','job_id','result_id','upload_count','method','route','auth_method','source','is_test','$session_id','$window_id','$device_id','$lib','$lib_version','$browser','$browser_version','$os','$os_version','$screen_height','$screen_width','$viewport_height','$viewport_width','$is_identified','$process_person_profile','$anon_distinct_id','$exception_list','$set','$set_once','$current_url','$pathname'])
export function analyticsRoute(path=''){
 return path.split('?')[0].split('#')[0].replace(/\/(r|claim)\/[^/]+/g,'/$1/:token').replace(/\/(results|generations|uploads|sessions)\/[^/]+/g,'/$1/:id')
}
export function sanitizeAnalyticsEvent(event){
 if(!event)return null
 const properties={}
 for(const [key,value] of Object.entries(event.properties||{})){
  if(!keys.has(key))continue
  if(key==='$set'||key==='$set_once'){properties[key]={app:'phbo'};continue}
  if(key==='$current_url'||key==='$pathname'||key==='route'){properties[key]=analyticsRoute(String(value));continue}
  if(key==='$exception_list'){
   properties[key]=(Array.isArray(value)?value:[]).slice(0,3).map(e=>({type:/^[A-Za-z][\w.]{0,80}$/.test(e.type)?e.type:'Error',value:'Application exception (message redacted)',mechanism:e.mechanism?{type:e.mechanism.type,handled:e.mechanism.handled}:undefined,stacktrace:{frames:(e.stacktrace?.frames||[]).slice(-30).map(f=>({filename:analyticsRoute(String(f.filename||'')).replace(/https?:\/\/[^/]+/g,''),function:f.function,lineno:f.lineno,colno:f.colno,in_app:f.in_app}))}}));continue
  }
  if(['string','boolean','number'].includes(typeof value))properties[key]=typeof value==='string'?value.slice(0,160):value
 }
 return {event:event.event,uuid:event.uuid,timestamp:event.timestamp,properties:{...properties,app:'phbo'},...(event.$set?{$set:{app:'phbo'}}:{}),...(event.$set_once?{$set_once:{app:'phbo'}}:{})}
}

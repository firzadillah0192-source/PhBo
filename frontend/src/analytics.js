import posthog from 'posthog-js'
import {analyticsRoute,sanitizeAnalyticsEvent} from './analyticsPrivacy.js'
const env=import.meta.env||{}
let active=false,lastPage='',terminalJobs=new Set()
export function initializeAnalytics(){
 const token=env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN,host=env.VITE_PUBLIC_POSTHOG_HOST
 if(!token||!host){if(env.DEV)throw new Error('VITE_PUBLIC_POSTHOG_PROJECT_TOKEN and VITE_PUBLIC_POSTHOG_HOST required by PostHog are missing or un-configured.');return null}
 if(active)return posthog
 try{
  posthog.init(token,{api_host:host,persistence_name:'phbo',cross_subdomain_cookie:false,save_referrer:false,save_campaign_params:false,advanced_disable_feature_flags:true,advanced_disable_feature_flags_on_first_load:true,defaults:'2026-05-30',autocapture:false,capture_pageview:false,capture_pageleave:false,disable_session_recording:true,disable_surveys:true,capture_exceptions:true,person_profiles:'identified_only',before_send:event=>{const safe=sanitizeAnalyticsEvent(event);return safe?{...safe,properties:{...safe.properties,token}}:null}})
  active=true
  analyticsPageview()
  window.addEventListener('popstate',analyticsPageview)
  return posthog
 }catch{console.warn('PhBo analytics initialization unavailable');return null}
}
export function analyticsPageview(){if(!active)return;const path=analyticsRoute(window.location.pathname);if(path===lastPage)return;lastPage=path;trackAnalytics('$pageview',{$current_url:path,$pathname:path})}
export function trackAnalytics(event,properties={}){if(!active)return;try{posthog.capture(event,{app:'phbo',...properties})}catch{}}
export function analyticsHeaders(){if(!active)return {};try{return {'X-POSTHOG-DISTINCT-ID':posthog.get_distinct_id(),'X-POSTHOG-SESSION-ID':posthog.get_session_id()}}catch{return {}}}
export function identifyAnalytics(account){const id=account?.analytics_id||(account?.id?'phbo-account:'+account.id:null);if(!active||!/^phbo-account:[A-Za-z0-9_-]{1,128}$/.test(id||''))return;try{posthog.identify(id,{app:'phbo'})}catch{}}
export function resetAnalytics(){if(!active)return;try{posthog.reset()}catch{}}
export function captureAnalyticsError(error,properties={}){if(!active)return;try{const safe=new Error('Application request failed');safe.name=error?.name||'Error';safe.stack=error?.stack;posthog.captureException(safe,{...properties,error_code:error?.errorCode||'REQUEST_FAILED',status:error?.status})}catch{}}
export function trackApiOutcome(path,method,data,surface){
 if(!active)return
 const route=analyticsRoute(path),properties={surface,route,method}
 if(/\/account\/(me|login|signup|google)$|\/login\/google$/.test(path)||surface==='kiosk'&&path==='/access'){
  const account=data?.analytics_id?data:(data?.account||data)
  identifyAnalytics(account)
  if(method==='POST'&&!account?.analytics_id&&!account?.id)fetch(surface==='kiosk'?'/api/kiosk/access':'/api/account/me',{credentials:'include',cache:'no-store',headers:analyticsHeaders()}).then(r=>r.ok?r.json():null).then(identifyAnalytics).catch(()=>{})
  if(method==='POST')trackAnalytics('phbo_login_succeeded',{...properties,auth_method:path.endsWith('google')?'google':'password'})
 }
 if(/\/logout$/.test(path)){trackAnalytics('phbo_logout_succeeded',properties);resetAnalytics()}
 if(method==='POST'&&path.endsWith('/uploads'))trackAnalytics('phbo_upload_succeeded',properties)
 if(method==='POST'&&path.endsWith('/generations'))trackAnalytics('phbo_generation_accepted',{...properties,job_id:data.job_id,status:data.state})
 if(/\/generations\/[^/]+$/.test(path)&&['COMPLETED','FAILED'].includes(data?.state)&&!terminalJobs.has(data.job_id)){
  if(terminalJobs.size>1000)terminalJobs.clear();terminalJobs.add(data.job_id);trackAnalytics('phbo_generation_'+data.state.toLowerCase(),{...properties,job_id:data.job_id,status:data.state})
 }
 if(method==='POST'&&/\/results\/[^/]+\/claim$/.test(path))trackAnalytics('phbo_result_qr_ready',properties)
}

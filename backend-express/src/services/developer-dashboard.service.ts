import {z} from 'zod';
import {AppError} from '../lib/errors.js';
import type {DeveloperDashboardModel,DashboardPeriod} from '../models/developer-dashboard.model.js';
import type {SubscriptionWalletModel} from '../models/subscription-wallet.model.js';
const query=z.object({days:z.coerce.number().int().refine(n=>[7,30,90].includes(n)).default(30),key_id:z.string().regex(/^[a-f0-9]{16}$/).optional(),state:z.enum(['QUEUED','PROCESSING','COMPLETED','FAILED']).optional(),limit:z.coerce.number().int().min(1).max(50).default(20),cursor:z.string().max(256).optional(),_request:z.string().max(128).optional()}).strict();
const fields=['requests','generation_requests','jobs','completed','failed','queued','processing','credits_spent','credits_reserved','credits_refunded'];
export class DeveloperDashboardService{
 constructor(private readonly model:DeveloperDashboardModel,private readonly wallet:Pick<SubscriptionWalletModel,'snapshot'>,private readonly clock=()=>new Date()){}
 private async context(accountId:string,raw:unknown){
  const input=query.parse(raw);if(input.key_id&&!await this.model.keyOwned(accountId,input.key_id))throw new AppError(404,'API_KEY_NOT_FOUND','API key not found.');
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(this.clock());
  const start=new Date(day+'T00:00:00+07:00'),to=new Date(start.getTime()+86400000),from=new Date(start.getTime()-(input.days-1)*86400000);
  const dayString=(date:Date)=>new Date(date.getTime()+7*3600000).toISOString().slice(0,10);
  const period:DashboardPeriod={from,to,days:input.days,from_day:dayString(from),to_day:dayString(to)};return {input,period};
 }
 async summary(accountId:string,raw:unknown){
  const {input,period}=await this.context(accountId,raw);
  const [entries,keys,wallet]=await Promise.all([this.model.daily(accountId,period,input.key_id??null),this.model.keys(accountId,period),this.wallet.snapshot({account_id:accountId,guest_id:null})]);
  const map=new Map(entries.map(row=>[String(row.day),row]));const daily:Array<{day:string}&Record<string,string|number>>=[];
  for(let n=0;n<period.days;n++){const day=new Date(period.from.getTime()+n*86400000+7*3600000).toISOString().slice(0,10);daily.push({day,...Object.fromEntries(fields.map(f=>[f,Number(map.get(day)?.[f]??0)]))});}
  const totals=Object.fromEntries(fields.map(field=>[field,daily.reduce((sum,row)=>sum+Number((row as Record<string,unknown>)[field]),0)]));
  return {period:{days:period.days,from:period.from,to:period.to,timezone:'Asia/Jakarta'},selected_key_id:input.key_id??null,totals,daily,keys,wallet:{plan:{code:wallet.plan.code,name:wallet.plan.name},period_end:wallet.period_end,ai:wallet.ai,classic:wallet.classic,storage:wallet.storage},history_notice:'Per-key job history includes only jobs recorded after dashboard activation. Generation request counts include failed validation and retries; job and credit totals count unique recorded jobs.'};
 }
 async history(accountId:string,raw:unknown){
  const {input,period}=await this.context(accountId,raw);let cursor;
  if(input.cursor){const match=/^([^|]+)\|([a-f0-9]{32})$/.exec(Buffer.from(input.cursor,'base64url').toString());const at=match?new Date(match[1]):null;if(!match||!at||Number.isNaN(at.getTime()))throw new AppError(422,'CURSOR_INVALID','Invalid cursor.');cursor={at,id:match[2]};}
  const rows=await this.model.history(accountId,period,{keyId:input.key_id,state:input.state,cursor,limit:input.limit});const page=rows.slice(0,input.limit),last=page.at(-1);
  return {generations:page.map(row=>({job_id:row.id,key:{id:row.key_id,name:row.key_name,prefix:row.key_prefix},template_id:row.template_id,state:row.state,created_at:row.created_at,finished_at:row.finished_at,error_code:row.error_code,credit_charge:{credits:row.credits,status:row.charge_status==='CONSUMED'?'PAID':row.charge_status},result_available:Boolean(row.available),result_id:row.available?row.result_id:null,expires_at:row.expires_at,download_url:row.available?`/api/results/${row.result_id}/download`:null})),next_cursor:rows.length>input.limit&&last?Buffer.from(last.created_at.toISOString()+'|'+last.id).toString('base64url'):null};
 }
}

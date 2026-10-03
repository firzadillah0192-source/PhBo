import { z } from 'zod';
import type { NxAccount, NxSubscription, NxGenerationJob, NxAuditLog, Prisma } from '@prisma/client';
import type { AdminDataModel } from '../models/admin-data.model.js';
import type { CatalogAssetsService } from './catalog-assets.service.js';
import type { AdminPrincipal } from './admin-auth.service.js';
import { AppError } from '../lib/errors.js';
import { legacyId } from './customer-credentials.service.js';

export const jsonObject = (text: string | null) => { try { const value: unknown = JSON.parse(text || 'null'); return value && typeof value === 'object' && !Array.isArray(value) ? value : null; } catch { return null; } };
export const confirmation = z.object({ confirm: z.literal(true), reason: z.string().min(3).max(1000) });
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(64);
const planInput = z.object({ id: slug, code: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/).max(64), name: z.string().min(1).max(255), description: z.string().default(''), monthly_ai_credits: z.number().int().min(0).max(100000).default(0), billing_period: z.string().min(1).max(32).default('month'), price_amount: z.number().int().nonnegative().nullable().optional(), currency: z.string().max(8).nullable().optional(), is_active: z.boolean().default(true) }).strict();
const adminInput = z.object({ id: slug, name: z.string().min(1).max(255), email: z.string().email().nullable().optional(), role: z.enum(['superadmin', 'operator', 'content_manager']), is_active: z.boolean().default(true) }).strict();
export const balance = (account: NxAccount) => ({ total: account.ai_quota_total, used: account.ai_quota_used, reserved: account.ai_quota_reserved, remaining: Math.max(0, account.ai_quota_total-account.ai_quota_used-account.ai_quota_reserved) });
export const auditItem = (row: NxAuditLog) => ({ id: row.id, admin_actor_id: row.admin_actor_id, action: row.action, target_type: row.target_type, target_id: row.target_id, reason: row.reason, metadata: jsonObject(row.metadata_json), created_at: row.created_at });
export function pagination(query: Record<string, unknown>, defaultSize = 25, maximum = 100) {
  const page = z.coerce.number().int().min(1).default(1).parse(query.page);
  const page_size = z.coerce.number().int().min(1).max(maximum).default(defaultSize).parse(query.page_size);
  return { page, page_size, skip: (page-1)*page_size };
}
export class AdminOperationsService {
  constructor(readonly model: AdminDataModel, readonly assets: CatalogAssetsService, readonly safeSettings: object) {}
  async account(id: string) { const row = await this.model.read(db => db.nxAccount.findUnique({ where: { id } })); if (!row) throw new AppError(404,'USER_NOT_FOUND','User not found.'); return row; }
  async subscriptionItem(row: NxSubscription | null) {
    if (!row) return null;
    const plan = await this.model.read(db => db.nxPlan.findUnique({ where: { id: row.plan_id } }));
    return { id: row.id, user_id: row.user_id, plan_id: row.plan_id, plan_code: plan?.code ?? null, plan_name: plan?.name ?? null, monthly_ai_credits: plan?.monthly_ai_credits ?? null, status: row.status, source: row.source, starts_at: row.starts_at, current_period_start: row.current_period_start, current_period_end: row.current_period_end, cancel_at_period_end: row.cancel_at_period_end, created_at: row.created_at, updated_at: row.updated_at };
  }
  async userItem(account: NxAccount) {
    const data = await this.model.read(async db => {
      const subscription = await db.nxSubscription.findFirst({ where: { user_id: account.id, status: 'active' }, orderBy: { created_at: 'desc' } });
      return { identity: await db.nxAuthIdentity.findFirst({ where: { account_id: account.id }, orderBy: { created_at: 'asc' } }), subscription,
        plan: subscription ? await db.nxPlan.findUnique({ where: { id: subscription.plan_id } }) : null,
        count: await db.nxGenerationJob.count({ where: { account_id: account.id } }), last: await db.nxGenerationJob.findFirst({ where: { account_id: account.id }, orderBy: { created_at: 'desc' } }) };
    });
    const dates = [account.last_activity_at, data.last?.created_at].filter((value): value is Date => !!value);
    return { id: account.id, name: account.display_name, email: account.email, avatar_url: account.avatar_url, auth_provider: data.identity?.provider || 'password', status: account.status,
      subscription_plan: data.plan?.code ?? null, ai_remaining: balance(account).remaining, ai_total: account.ai_quota_total, ai_used: account.ai_quota_used, total_generations: data.count, last_activity_at: dates.length ? new Date(Math.max(...dates.map(value=>value.getTime()))) : null, created_at: account.created_at };
  }
  async overview() {
    const today = new Date(); today.setUTCHours(0,0,0,0); const since = new Date(Date.now()-30*86400000);
    const counts = await this.model.read(async db => ({ total_users: await db.nxAccount.count(), new_users_today: await db.nxAccount.count({ where: { created_at: { gte: today } } }), active_users: await db.nxAccount.count({ where: { OR: [{ created_at: { gte: since } }, { last_activity_at: { gte: since } }] } }),
      advanced_generations_today: await db.nxGenerationJob.count({ where: { mode:'ADVANCED', created_at: { gte:today } } }), successful_generations: await db.nxGenerationJob.count({ where:{state:'COMPLETED'} }), failed_generations: await db.nxGenerationJob.count({where:{state:'FAILED'}}), queued_jobs: await db.nxGenerationJob.count({where:{state:'QUEUED'}}), processing_jobs: await db.nxGenerationJob.count({where:{state:'PROCESSING'}}),
      ai_credits_consumed: Math.abs((await db.nxCreditLedger.aggregate({where:{type:'generation_spend'},_sum:{amount:true}}))._sum.amount || 0), active_subscriptions: await db.nxSubscription.count({where:{status:'active'}}), experiences: await db.nxExperience.findMany() }));
    const {experiences,...data}=counts; let missing=0; for(const row of experiences) if(!await this.assets.file(row.thumbnail_path)) missing++;
    return {...data,total_experiences:experiences.length,published_experiences:experiences.filter(row=>row.status==='published').length,draft_experiences:experiences.filter(row=>row.status==='draft').length,disabled_experiences:experiences.filter(row=>row.status==='disabled').length,missing_experience_previews:missing};
  }
  async users(query: Record<string, unknown>) {
    const {page,page_size,skip}=pagination(query); const search=z.string().optional().parse(query.search)?.trim(); const status=z.enum(['active','suspended']).optional().parse(query.status);
    const sort=z.string().default('created_at').parse(query.sort), direction=z.enum(['asc','desc']).default('desc').parse(query.direction);
    const column = ({created_at:'created_at',last_activity:'last_activity_at',email:'email',credits:'ai_quota_total'} as const)[sort as 'created_at'] || 'created_at';
    const where: Prisma.NxAccountWhereInput={...(status?{status}:{}),...(search?{OR:[{email:{contains:search,mode:'insensitive'}},{display_name:{contains:search,mode:'insensitive'}}]}:{})};
    const data=await this.model.read(async db=>({total:await db.nxAccount.count({where}),rows:await db.nxAccount.findMany({where,orderBy:{[column]:direction},skip,take:page_size})}));
    return {users:await Promise.all(data.rows.map(row=>this.userItem(row))),page,page_size,total:data.total,pages:Math.max(1,Math.ceil(data.total/page_size))};
  }
  async user(id:string) { const account=await this.account(id); const data=await this.model.read(async db=>({identities:await db.nxAuthIdentity.findMany({where:{account_id:id}}),subscription:await db.nxSubscription.findFirst({where:{user_id:id,status:'active'},orderBy:{created_at:'desc'}})})); return {user:await this.userItem(account),identities:data.identities.map(({provider,provider_subject,email,created_at,last_login_at})=>({provider,provider_subject,email,created_at,last_login_at})),subscription:await this.subscriptionItem(data.subscription)}; }
  async credits(id:string|null,query:Record<string,unknown>) { const account=id?await this.account(id):null; const {page,page_size,skip}=pagination(query,50,200); const type=z.string().optional().parse(query.entry_type);
    const where={...(id?{user_id:id}:{}),...(type?{type}:{})}; const data=await this.model.read(async db=>({total:await db.nxCreditLedger.count({where}),entries:await db.nxCreditLedger.findMany({where,orderBy:{created_at:'desc'},skip,take:page_size})}));
    return {...(account?{balance:balance(account)}:{}),entries:data.entries.map(({metadata_json,...row})=>row),page,page_size,total:data.total}; }
  async sessions(id:string) {await this.account(id);return (await this.model.read(db=>db.nxAuthSession.findMany({where:{account_id:id,is_admin:false},orderBy:{created_at:'desc'}}))).map(row=>({id:row.id.slice(-12),created_at:row.created_at,last_seen_at:row.last_seen_at,expires_at:row.expires_at,active:row.expires_at>new Date()}));}
  async audit(query:Record<string,unknown>,id?:string) {const limit=z.coerce.number().int().min(1).max(500).default(100).parse(query.limit);const action=z.string().optional().parse(query.action);return (await this.model.read(db=>db.nxAuditLog.findMany({where:{...(id?{target_id:id}:{}),...(action?{action}:{})},orderBy:{created_at:'desc'},take:limit}))).map(auditItem);}
  async status(id:string,body:unknown,actor:AdminPrincipal,revoke=false) {const input=confirmation.extend({status:z.enum(['active','suspended'])}).parse(body);return this.model.transaction(async tx=>{
    if(!await tx.nxAccount.findUnique({where:{id}}))throw new AppError(404,'USER_NOT_FOUND','User not found.');
    if(!revoke)await tx.nxAccount.update({where:{id},data:{status:input.status,updated_at:new Date()}});
    const revoked=revoke||input.status==='suspended'?(await tx.nxAuthSession.deleteMany({where:{account_id:id,is_admin:false}})).count:0;
    await this.model.audit(tx,actor,revoke?'user_sessions_revoked':input.status==='suspended'?'user_suspended':'user_unsuspended','user',id,input.reason,{revoked_sessions:revoked});return {status:input.status,revoked_sessions:revoked}; });}
  async adjust(id:string,body:unknown,actor:AdminPrincipal) {const input=confirmation.extend({amount:z.number().int().min(-100000).max(100000).refine(n=>n!==0),idempotency_key:z.string().max(255).optional()}).parse(body);const key=input.idempotency_key||`admin_adjustment:${actor.actor_id}:${id}:${legacyId()}`;
    return this.model.transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM accounts WHERE id=${id} FOR UPDATE`;const account=await tx.nxAccount.findUnique({where:{id}});if(!account)throw new AppError(404,'USER_NOT_FOUND','User not found.');
      const existing=await tx.nxCreditLedger.findUnique({where:{idempotency_key:key}});
      if(existing){if(existing.user_id!==id||existing.amount!==input.amount)throw new AppError(422,'CREDIT_ADJUSTMENT_REJECTED','Idempotency key belongs to a different adjustment.');return {changed:false,ledger_id:existing.id,balance:balance(account)};}
      if(input.amount<0&&balance(account).remaining < -input.amount)throw new AppError(422,'CREDIT_ADJUSTMENT_REJECTED','Cannot deduct credits already used or reserved.');
      const updated=await tx.nxAccount.update({where:{id},data:{ai_quota_total:{increment:input.amount},updated_at:new Date()}});
      const ledger=await tx.nxCreditLedger.create({data:{id:legacyId(),user_id:id,amount:input.amount,type:input.amount>0?'admin_grant':'admin_adjustment',reason:input.reason,admin_actor_id:actor.actor_id,idempotency_key:key}});
      await this.model.audit(tx,actor,input.amount>0?'credit_granted':'credit_deducted','user',id,input.reason,{amount:input.amount,ledger_id:ledger.id});return {changed:true,ledger_id:ledger.id,balance:balance(updated)};
    }); }
  plans(){return this.model.read(db=>db.nxPlan.findMany({orderBy:{created_at:'asc'}}));}
  async savePlan(id:string|null,body:unknown,actor:AdminPrincipal){const input=id?planInput.omit({id:true,code:true}).partial().parse(body):planInput.parse(body);return this.model.transaction(async tx=>{const row=id?await tx.nxPlan.update({where:{id},data:{...input,updated_at:new Date()}}):await tx.nxPlan.create({data:planInput.parse(body)});await this.model.audit(tx,actor,id?'plan_changed':'plan_created','plan',row.id,'',input);return row;});}
  async subscriptions(){return Promise.all((await this.model.read(db=>db.nxSubscription.findMany({orderBy:{updated_at:'desc'},take:200}))).map(async row=>({...await this.subscriptionItem(row),user_email:(await this.account(row.user_id)).email})));}
  async subscription(id:string,body:unknown,actor:AdminPrincipal){const input=confirmation.extend({action:z.enum(['assign','activate','cancel','expire']),plan_id:z.string().optional()}).parse(body);const row=await this.model.transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM accounts WHERE id=${id} FOR UPDATE`;if(!await tx.nxAccount.findUnique({where:{id}}))throw new AppError(404,'USER_NOT_FOUND','User not found.');
    let current=await tx.nxSubscription.findFirst({where:{user_id:id,status:'active'},orderBy:{created_at:'desc'}});
    if(input.action==='assign'||input.action==='activate'){
      if(!input.plan_id)throw new AppError(422,'PLAN_REQUIRED','plan_id is required for assignment.'); const plan=await tx.nxPlan.findUnique({where:{id:input.plan_id}});if(!plan)throw new AppError(404,'PLAN_NOT_FOUND','Plan not found.');
      if(current?.plan_id!==plan.id){if(current)await tx.nxSubscription.update({where:{id:current.id},data:{status:'expired',updated_at:new Date()}});const now=new Date();current=await tx.nxSubscription.create({data:{id:legacyId(),user_id:id,plan_id:plan.id,current_period_start:now,current_period_end:new Date(now.getTime()+30*86400000)}});}
      const key=`subscription_grant:${current!.id}:${current!.current_period_start.toISOString().slice(0,10)}`;
      if(plan.monthly_ai_credits>0&&!await tx.nxCreditLedger.findUnique({where:{idempotency_key:key}})){
        await tx.nxAccount.update({where:{id},data:{ai_quota_total:{increment:plan.monthly_ai_credits}}});await tx.nxCreditLedger.create({data:{id:legacyId(),user_id:id,amount:plan.monthly_ai_credits,type:'subscription_grant',reason:`Manual subscription allocation for ${plan.code}`,idempotency_key:key,metadata_json:JSON.stringify({plan_id:plan.id,period_key:current!.current_period_start.toISOString().slice(0,10)})}});
      }
    }else{if(!current)throw new AppError(404,'SUBSCRIPTION_NOT_FOUND','No active subscription found.');current=await tx.nxSubscription.update({where:{id:current.id},data:{status:input.action==='cancel'?'cancelled':'expired',cancel_at_period_end:input.action==='cancel',updated_at:new Date()}});}
    await this.model.audit(tx,actor,`subscription_${input.action}`,'subscription',current!.id,input.reason,{user_id:id,plan_id:current!.plan_id});return current!;
  });return this.subscriptionItem(row);}
  async creditState(id:string){const reservation=await this.model.read(db=>db.nxQuotaReservation.findUnique({where:{job_id:id}}));return !reservation?'not_applicable':reservation.status==='RESERVED'?'reserved':reservation.status==='CONSUMED'?'spent':'refunded';}
  async generationItem(job:NxGenerationJob){return {job_id:job.id,user_id:job.account_id,user_email:job.account_id?(await this.model.read(db=>db.nxAccount.findUnique({where:{id:job.account_id!}})))?.email??null:null,guest_id:job.guest_id,mode:job.mode,experience_id:job.experience_id,template_id:job.template_id||null,state:job.state,credit_state:await this.creditState(job.id),created_at:job.created_at,updated_at:job.updated_at,started_at:job.started_at,finished_at:job.finished_at,duration_seconds:job.started_at&&job.finished_at?Math.max(0,(job.finished_at.getTime()-job.started_at.getTime())/1000):null};}
  async generations(query:Record<string,unknown>,userId?:string){const {page,page_size,skip}=pagination(query);const state=z.string().optional().parse(query.state),mode=z.enum(['CLASSIC','BASIC','ADVANCED']).optional().parse(query.mode);const user_id=userId||z.string().optional().parse(query.user_id);const where={...(state?{state}:{}),...(mode?{mode}:{}),...(user_id?{account_id:user_id}:{})};const data=await this.model.read(async db=>({total:await db.nxGenerationJob.count({where}),rows:await db.nxGenerationJob.findMany({where,orderBy:{created_at:'desc'},skip,take:page_size})}));return {jobs:await Promise.all(data.rows.map(row=>this.generationItem(row))),page,page_size,total:data.total,pages:Math.max(1,Math.ceil(data.total/page_size))};}
  async generation(id:string){const data=await this.model.read(async db=>{const job=await db.nxGenerationJob.findUnique({where:{id}});const result=await db.nxResult.findUnique({where:{job_id:id}});return {job,events:await db.nxGenerationEvent.findMany({where:{job_id:id},orderBy:{created_at:'asc'}}),claims:result?await db.nxResultClaim.findMany({where:{result_id:result.id},orderBy:{created_at:'desc'}}):[]};});if(!data.job)throw new AppError(404,'GENERATION_NOT_FOUND','Generation not found.');return {job:await this.generationItem(data.job),error_code:data.job.error_code,error_message:data.job.error_message,events:data.events.map(row=>({type:row.event_type,detail:row.detail,metadata:jsonObject(row.metadata_json),created_at:row.created_at})),claims:data.claims.map(({token_hash,metadata_json,created_by_session_id,created_by_kiosk_session_id,id,...row})=>({claim_id:id,...row,expired:row.expires_at<=new Date()}))};}
  async revokeClaim(id:string,body:unknown,actor:AdminPrincipal){const input=confirmation.parse(body);return this.model.transaction(async tx=>{const claim=await tx.nxResultClaim.findUnique({where:{id}});if(!claim)throw new AppError(404,'CLAIM_NOT_FOUND','Claim not found.');if(!claim.is_revoked){await tx.nxResultClaim.update({where:{id},data:{is_revoked:true}});const result=await tx.nxResult.findUnique({where:{id:claim.result_id}});if(result)await tx.nxGenerationEvent.create({data:{id:legacyId(),job_id:result.job_id,event_type:'claim_revoked',detail:input.reason,metadata_json:JSON.stringify({claim_id:id})}});await this.model.audit(tx,actor,'result_claim_revoked','result_claim',id,input.reason);}return {claim_id:id,revoked:true};});}
  adminUsers(){return this.model.read(db=>db.nxAdminUser.findMany({orderBy:{created_at:'asc'}}));}
  async saveAdmin(id:string|null,body:unknown,actor:AdminPrincipal){const input=id?adminInput.omit({id:true}).partial().parse(body):adminInput.parse(body);return this.model.transaction(async tx=>{const row=id?await tx.nxAdminUser.update({where:{id},data:{...input,updated_at:new Date()}}):await tx.nxAdminUser.create({data:adminInput.parse(body)});await this.model.audit(tx,actor,id?'admin_role_changed':'admin_role_added','admin_user',row.id,'',input);return row;});}
}

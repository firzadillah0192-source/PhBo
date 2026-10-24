import type { Prisma, PrismaClient } from '@prisma/client';
import type { SubscriptionWalletModel } from '../models/subscription-wallet.model.js';
import type { AdminPrincipal } from '../services/admin-auth.service.js';
import { AppError } from '../lib/errors.js';
import { creditAllocation, hasStorageCapacity } from '../services/subscription-policy.service.js';
import { legacyId } from '../services/customer-credentials.service.js';
import { MAX_ASSET_BYTES, POSE_COUNT, PREPARATION_CREDITS } from './policy.js';

type Tx=Prisma.TransactionClient;
export type DuetPoseRow={template_id:string;slot:number;pose_key:string;overlay_path:string;width:number;height:number;size_bytes:number};
export type DuetPoseOutput={slot:number;key:string;path:string;width:number;height:number;size:number};
export type DuetRow={id:string;pose_keys:string[];account_id:string;request_key:string;fingerprint:string;name:string;state:'QUEUED'|'PROCESSING'|'COMPLETED'|'FAILED';enabled:boolean;source_path:string;overlay_path:string|null;model:string;source_bytes:number;size_bytes:number;width:number|null;height:number|null;placement:{side:'left'|'right';scale:number};credits:number;charge_status:'RESERVED'|'CONSUMED'|'REFUNDED';monthly_part:number;top_up_part:number;period_start:Date;lease_token:string|null;lease_until:Date|null;error_code:string|null;created_at:Date;updated_at:Date;deleted_at:Date|null};
export class DuetModel {
  constructor(readonly db:PrismaClient,readonly wallets:SubscriptionWalletModel){}
  async ready(){await this.db.$queryRaw`SELECT id,charge_status,placement,pose_keys FROM nxduet_templates LIMIT 0`;await this.db.$queryRaw`SELECT template_id,slot FROM nxduet_template_poses LIMIT 0`;}
  poses(id:string){return this.db.$queryRaw<DuetPoseRow[]>`SELECT * FROM nxduet_template_poses WHERE template_id=${id} ORDER BY slot`;}
  async posesFor(ids:string[]){const map=new Map<string,DuetPoseRow[]>();if(!ids.length)return map;for(const row of await this.db.$queryRaw<DuetPoseRow[]>`SELECT * FROM nxduet_template_poses WHERE template_id=ANY(${ids}) ORDER BY template_id,slot`)map.set(row.template_id,[...(map.get(row.template_id)??[]),row]);return map;}
  async find(id:string){const [row]=await this.db.$queryRaw<DuetRow[]>`SELECT * FROM nxduet_templates WHERE id=${id}`;return row??null;}
  async request(account:string,key:string){const [row]=await this.db.$queryRaw<DuetRow[]>`SELECT * FROM nxduet_templates WHERE account_id=${account} AND request_key=${key}`;return row??null;}
  list(account:string,offset=0){return this.db.$queryRaw<DuetRow[]>`SELECT * FROM nxduet_templates WHERE account_id=${account} AND deleted_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET ${offset}`;}
  adminList(account:string|null,offset=0){return this.db.$queryRaw<DuetRow[]>`SELECT * FROM nxduet_templates WHERE (${account}::text IS NULL OR account_id=${account}) ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET ${offset}`;}
  async create(input:{id:string;account:string;key:string;fingerprint:string;name:string;poses:string[];source:string;sourceBytes:number;model:string}){
    return this.db.$transaction(async tx=>{
      const wallet=await this.wallets.ensureIn(tx,{account_id:input.account,guest_id:null});
      const [existing]=await tx.$queryRaw<DuetRow[]>`SELECT * FROM nxduet_templates WHERE account_id=${input.account} AND request_key=${input.key}`;
      if(existing){if(existing.fingerprint!==input.fingerprint)throw new AppError(409,'IDEMPOTENCY_CONFLICT','Permintaan sudah dipakai untuk template berbeda.');return {row:existing,reused:true};}
      // snapshotIn includes NXDuet reservations when the feature is enabled.
      const state=await this.wallets.snapshotIn(tx,{account_id:input.account,guest_id:null}),storage=state.storage;
      if(!hasStorageCapacity(storage.limit_bytes,storage.used_bytes,storage.reserved_bytes,POSE_COUNT*MAX_ASSET_BYTES+input.sourceBytes))throw new AppError(409,'STORAGE_QUOTA_EXCEEDED','Ruang penyimpanan tidak cukup untuk template baru.');
      const part=creditAllocation(state.ai.monthly_remaining,state.ai.top_up_remaining,PREPARATION_CREDITS);
      await tx.$executeRaw`UPDATE subscription_v2_wallets SET ai_monthly=ai_monthly-${part.subscription},ai_top_up=ai_top_up-${part.top_up},updated_at=now() WHERE owner_scope=${wallet.owner_scope}`;
      const [row]=await tx.$queryRaw<DuetRow[]>`INSERT INTO nxduet_templates(id,account_id,request_key,fingerprint,name,pose_keys,placement,source_path,source_bytes,model,monthly_part,top_up_part,period_start)
        VALUES(${input.id},${input.account},${input.key},${input.fingerprint},${input.name},${JSON.stringify(input.poses)}::jsonb,'{"side":"left","scale":0.9}'::jsonb,${input.source},${input.sourceBytes},${input.model},${part.subscription},${part.top_up},${state.period_start}) RETURNING *`;
      await tx.$executeRaw`INSERT INTO subscription_v2_ledger(owner_scope,currency,amount,reason,idempotency_key) VALUES(${wallet.owner_scope},'AI',${-PREPARATION_CREDITS},'NXDuet: reservasi penyiapan template',${`v2:hold:nxduet:${input.id}`})`;
      return {row:row!,reused:false};
    });
  }
  async claim(){
    const token=legacyId();
    const [row]=await this.db.$queryRaw<DuetRow[]>`UPDATE nxduet_templates SET state='PROCESSING',lease_token=${token},lease_until=now()+interval '2 minutes',updated_at=now()
      WHERE id=(SELECT id FROM nxduet_templates WHERE state='QUEUED' AND deleted_at IS NULL ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`;
    return row??null;
  }
  async renew(id:string,token:string){return this.db.$executeRaw`UPDATE nxduet_templates SET lease_until=now()+interval '2 minutes' WHERE id=${id} AND state='PROCESSING' AND lease_token=${token}`;}
  expired(){return this.db.$queryRaw<DuetRow[]>`SELECT * FROM nxduet_templates WHERE (state='PROCESSING' AND lease_until<now()) OR (state='QUEUED' AND created_at<now()-interval '30 minutes') ORDER BY created_at LIMIT 20`;}
  async finish(id:string,token:string,out:{poses:DuetPoseOutput[];meta:object}|null,error='NXDUET_PREPARATION_FAILED',expiredOnly=false){
    const found=await this.find(id);if(!found)return false;
    return this.db.$transaction(async tx=>{
      const wallet=await this.wallets.ensureIn(tx,{account_id:found.account_id,guest_id:null});
      const [row]=await tx.$queryRaw<DuetRow[]>`SELECT * FROM nxduet_templates WHERE id=${id} FOR UPDATE`;
      if(!row||row.charge_status!=='RESERVED'||row.lease_token!==token&&!(row.state==='QUEUED'&&token===''))return false;
      if(expiredOnly&&((row.state==='PROCESSING'&&row.lease_until!>new Date())||(row.state==='QUEUED'&&row.created_at>new Date(Date.now()-30*60_000))))return false;
      if(out&&(row.state!=='PROCESSING'||!row.enabled||row.deleted_at))return false;
      if(!out){
        const monthly=wallet.period_start.getTime()===row.period_start.getTime()?row.monthly_part:0;
        // Match existing period-aware refunds: expired monthly credits do not revive.
        await tx.$executeRaw`UPDATE subscription_v2_wallets SET ai_monthly=ai_monthly+${monthly},ai_top_up=ai_top_up+${row.top_up_part},updated_at=now() WHERE owner_scope=${wallet.owner_scope}`;
        await tx.$executeRaw`INSERT INTO subscription_v2_ledger(owner_scope,currency,amount,reason,idempotency_key) VALUES(${wallet.owner_scope},'AI',${monthly+row.top_up_part},'NXDuet: penyiapan gagal, reservasi dikembalikan',${`v2:refund:nxduet:${id}`})`;
        await tx.$executeRaw`UPDATE nxduet_templates SET state='FAILED',charge_status='REFUNDED',error_code=${error},lease_until=NULL,updated_at=now() WHERE id=${id}`;
      }else{
        const first=out.poses[0]!,total=out.poses.reduce((sum,pose)=>sum+pose.size,0);
        for(const pose of out.poses)await tx.$executeRaw`INSERT INTO nxduet_template_poses(template_id,slot,pose_key,overlay_path,width,height,size_bytes) VALUES(${id},${pose.slot},${pose.key},${pose.path},${pose.width},${pose.height},${pose.size})`;
        await tx.$executeRaw`UPDATE nxduet_templates SET state='COMPLETED',charge_status='CONSUMED',overlay_path=${first.path},width=${first.width},height=${first.height},size_bytes=${total},provider_meta=${JSON.stringify(out.meta)}::jsonb,lease_until=NULL,updated_at=now() WHERE id=${id}`;
      }
      return true;
    });
  }
  async patch(account:string,id:string,input:{name?:string;placement?:object}){
    const count=await this.db.$executeRaw`UPDATE nxduet_templates SET name=COALESCE(${input.name??null},name),placement=COALESCE(${input.placement?JSON.stringify(input.placement):null}::jsonb,placement),updated_at=now() WHERE id=${id} AND account_id=${account} AND deleted_at IS NULL AND enabled=true AND state='COMPLETED'`;
    if(!count)throw new AppError(404,'NXDUET_NOT_FOUND','Template tidak tersedia.');return this.find(id);
  }
  private audit(tx:Tx,actor:AdminPrincipal,action:string,id:string,reason:string){return tx.nxAuditLog.create({data:{id:legacyId(),admin_actor_id:actor.actor_id,action,target_type:'nxduet_template',target_id:id,reason}});}
  async control(id:string,action:'enable'|'disable'|'delete',actor?:AdminPrincipal,reason='',account?:string){
    return this.db.$transaction(async tx=>{
      const [row]=await tx.$queryRaw<DuetRow[]>`SELECT * FROM nxduet_templates WHERE id=${id} AND (${account??null}::text IS NULL OR account_id=${account??null}) AND deleted_at IS NULL FOR UPDATE`;
      if(!row)throw new AppError(404,'NXDUET_NOT_FOUND','Template tidak tersedia.');
      if(row.state==='QUEUED'||row.state==='PROCESSING')throw new AppError(409,'NXDUET_PREPARATION_ACTIVE','Tunggu penyiapan selesai sebelum mengubah template.');
      if(action==='delete')await tx.$executeRaw`UPDATE nxduet_templates SET deleted_at=now(),enabled=false,updated_at=now() WHERE id=${id}`;
      else await tx.$executeRaw`UPDATE nxduet_templates SET enabled=${action==='enable'},updated_at=now() WHERE id=${id}`;
      if(actor)await this.audit(tx,actor,`nxduet_${action}`,id,reason);
      return row;
    });
  }
  cleanupRows(){return this.db.$queryRaw<DuetRow[]>`SELECT * FROM nxduet_templates WHERE (state IN ('COMPLETED','FAILED') AND source_path<>'') OR (deleted_at IS NOT NULL AND overlay_path IS NOT NULL) ORDER BY updated_at LIMIT 50`;}
  async cleaned(id:string,source:boolean,overlay:boolean){
    if(overlay)await this.db.$executeRaw`DELETE FROM nxduet_template_poses WHERE template_id=${id}`;
    await this.db.$executeRaw`UPDATE nxduet_templates SET source_path=CASE WHEN ${source} THEN '' ELSE source_path END,source_bytes=CASE WHEN ${source} THEN 0 ELSE source_bytes END,overlay_path=CASE WHEN ${overlay} THEN NULL ELSE overlay_path END,size_bytes=CASE WHEN ${overlay} THEN 0 ELSE size_bytes END WHERE id=${id}`;
  }
}

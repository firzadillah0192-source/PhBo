import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CustomerIdentity } from '../services/customer-account.service.js';
import type { CustomerUploadService } from '../services/customer-upload.service.js';
import type { NativeAIProvider } from '../services/native-provider.service.js';
import type { AdminPrincipal } from '../services/admin-auth.service.js';
import { legacyId } from '../services/customer-credentials.service.js';
import { AppError } from '../lib/errors.js';
import { DuetModel,type DuetPoseRow,type DuetRow } from './model.js';
import { DuetFiles,poseKind } from './files.js';
import type { DuetFrame } from './frame.js';
import { createSchema,idSchema,LEGACY_POSE_KEY,patchSchema,POSE_COUNT,poseLabel,POSES,PREPARATION_CREDITS } from './policy.js';

const pageSchema=z.coerce.number().int().min(0).max(100000).default(0);
export type DuetPoseView={slot:number;key:string;label:string;image_url:string|null};
export function poseViews(row:DuetRow,rows:DuetPoseRow[]=[]):DuetPoseView[]{
  const usable=row.state==='COMPLETED'&&row.enabled&&!row.deleted_at,url=(slot:number)=>usable?`/api/nxduet/templates/${row.id}/image?slot=${slot}`:null;
  if(rows.length)return rows.map(pose=>({slot:pose.slot,key:pose.pose_key,label:poseLabel(pose.pose_key),image_url:url(pose.slot)}));
  // Legacy single-pose template: the same cutout serves all three shots.
  if(row.state==='COMPLETED'&&!row.pose_keys?.length)return [1,2,3].map(slot=>({slot,key:LEGACY_POSE_KEY,label:poseLabel(LEGACY_POSE_KEY),image_url:url(slot)}));
  return (row.pose_keys??[]).map((key,index)=>({slot:index+1,key,label:poseLabel(key),image_url:null}));
}
export function duetResponse(row:DuetRow,admin=false,poses:DuetPoseRow[]=[]){
  return {id:row.id,name:row.name,state:row.state,enabled:row.enabled,placement:{side:'left',scale:row.placement.scale},poses:poseViews(row,poses),credits:row.credits,charge_status:row.charge_status,
    width:row.width,height:row.height,size_bytes:row.size_bytes,error_code:row.error_code,created_at:row.created_at,updated_at:row.updated_at,
    image_url:row.state==='COMPLETED'&&row.enabled&&!row.deleted_at?`/api/nxduet/templates/${row.id}/image`:null,
    ...(admin?{account_id:row.account_id,deleted_at:row.deleted_at}: {})};
}
export class DuetService {
  constructor(readonly model:DuetModel,readonly files:DuetFiles,private readonly uploads:CustomerUploadService,private readonly provider:NativeAIProvider,private readonly resolveModel:()=>Promise<string>,readonly frame?:DuetFrame){}
  async capabilities(){
    let frame:{ready:boolean;slot_width?:number;slot_height?:number}={ready:false};
    try{const slot=(await this.frame!.info()).slots[0]!;frame={ready:true,slot_width:slot.width,slot_height:slot.height};}catch{}
    return {enabled:true,preparation_credits:PREPARATION_CREDITS,pose_count:POSE_COUNT,poses:POSES.map(pose=>({key:pose.key,label:pose.label})),frame};
  }
  async owned(account:string,id:string,usable=false){
    const row=await this.model.find(idSchema.parse(id));
    if(!row||row.account_id!==account||row.deleted_at)throw new AppError(404,'NXDUET_NOT_FOUND','Template tidak tersedia.');
    if(usable&&(row.state!=='COMPLETED'||!row.enabled||!row.overlay_path))throw new AppError(409,'NXDUET_UNAVAILABLE','Template belum siap atau dinonaktifkan.');
    return row;
  }
  async list(account:string,offset:unknown){const rows=await this.model.list(account,pageSchema.parse(offset)),poses=await this.model.posesFor(rows.map(row=>row.id));return {templates:rows.map(row=>duetResponse(row,false,poses.get(row.id))),preparation_credits:PREPARATION_CREDITS};}
  async get(account:string,id:string){const row=await this.owned(account,id);return duetResponse(row,false,await this.model.poses(row.id));}
  async create(identity:CustomerIdentity,body:unknown,key:unknown){
    const account=identity.account?.id;if(!account)throw new AppError(401,'AUTHENTICATION_REQUIRED','Masuk untuk membuat template NXDuet.');
    const input=createSchema.parse(body),requestKey=z.string().regex(/^[A-Za-z0-9_-]{16,100}$/).parse(key);
    const fingerprint=createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const previous=await this.model.request(account,requestKey);
    if(previous){if(previous.fingerprint!==fingerprint)throw new AppError(409,'IDEMPOTENCY_CONFLICT','Permintaan sudah dipakai untuk template berbeda.');if(previous.deleted_at)throw new AppError(410,'NXDUET_DELETED','Template dari permintaan ini sudah dihapus.');return duetResponse(previous);}
    if(!this.provider.available())throw new AppError(503,'AI_PROVIDER_NOT_CONNECTED','Penyiapan teman foto belum terhubung. Kredit belum dipotong.');
    if(!this.frame)throw new AppError(503,'NXDUET_FRAME_UNAVAILABLE','Frame strip NXDuet belum tersedia. Kredit belum dipotong.');
    await this.frame.info().catch(()=>{throw new AppError(503,'NXDUET_FRAME_UNAVAILABLE','Frame strip NXDuet belum tersedia. Kredit belum dipotong.');});
    const model=await this.resolveModel();
    if(!model)throw new AppError(503,'AI_PROVIDER_NOT_CONNECTED','Penyiapan teman foto belum terhubung. Kredit belum dipotong.');
    const source=await this.uploads.owned(input.upload_id,identity),bytes=await this.uploads.read(source.path);
    const id=legacyId(),path=await this.files.put(id,'source',bytes);
    try{
      const result=await this.model.create({id,account,key:requestKey,fingerprint,name:input.name,poses:input.poses,source:path,sourceBytes:bytes.length,model});
      if(result.reused)await this.files.remove(id,path,'source').catch(()=>{});
      return duetResponse(result.row);
    }catch(error){
      // An ambiguous database commit must retain the input for worker recovery.
      // Only delete when a successful lookup confirms no durable row references it.
      try{const saved=await this.model.request(account,requestKey);if(!saved||saved.id!==id)await this.files.remove(id,path,'source');}catch{}
      throw error;
    }
  }
  private async asset(row:DuetRow,slot:number){
    const pose=(await this.model.poses(row.id)).find(item=>item.slot===slot);
    if(pose)return this.files.read(row.id,pose.overlay_path,poseKind(slot));
    if(row.pose_keys?.length)throw new AppError(404,'NXDUET_NOT_FOUND','Pose tidak tersedia.');
    return this.files.read(row.id,row.overlay_path!,'overlay');
  }
  async image(account:string,id:string,slot:unknown=1){const row=await this.owned(account,id,true);return this.asset(row,z.coerce.number().int().min(1).max(POSE_COUNT).parse(slot));}
  async overlays(account:string,id:string){const row=await this.owned(account,id,true),out:Buffer[]=[];for(let slot=1;slot<=POSE_COUNT;slot++)out.push(await this.asset(row,slot));return out;}
  async patch(account:string,id:string,body:unknown){await this.owned(account,id,true);const row=await this.model.patch(account,id,patchSchema.parse(body));return duetResponse(row!,false,await this.model.poses(id));}
  async remove(account:string,id:string){await this.model.control(idSchema.parse(id),'delete',undefined,'',account);}
  async adminList(query:Record<string,unknown>){const account=query.account_id===undefined||query.account_id===''?null:idSchema.parse(query.account_id),rows=await this.model.adminList(account,pageSchema.parse(query.offset)),poses=await this.model.posesFor(rows.map(row=>row.id));return {templates:rows.map(row=>duetResponse(row,true,poses.get(row.id)))};}
  async adminImage(id:string,slot:unknown=1){const row=await this.model.find(idSchema.parse(id));if(!row?.overlay_path||row.deleted_at)throw new AppError(404,'NXDUET_NOT_FOUND','Template tidak tersedia.');return this.asset(row,z.coerce.number().int().min(1).max(POSE_COUNT).parse(slot));}
  async adminControl(actor:AdminPrincipal,id:string,body:unknown){const input=z.object({action:z.enum(['enable','disable','delete']),reason:z.string().trim().min(3).max(500)}).strict().parse(body);await this.model.control(idSchema.parse(id),input.action,actor,input.reason);return {ok:true};}
}

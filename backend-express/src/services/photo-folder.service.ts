import { randomBytes } from 'node:crypto';
import type { NxAccount } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import { PhotoFolderModel, type Folder, type Photo, type Share } from '../models/photo-folder.model.js';
import { tokenHash } from './customer-credentials.service.js';
import type { CustomerIdentity } from './customer-account.service.js';
import type { CustomerResultService } from './customer-result.service.js';
const id=z.string().regex(/^[a-f0-9]{32}$/);
const nameInput=z.object({name:z.string().trim().min(1).max(80).regex(/^[^\p{Cc}\p{Cf}]+$/u)}).strict();
const destination=z.object({folder_id:id.nullable()}).strict();
const queryInput=z.object({folder_id:z.union([id,z.literal('unfiled')]).optional(),cursor:z.string().max(256).optional(),_request:z.string().max(128).optional(),limit:z.coerce.number().int().min(1).max(50).default(20)}).strict();
const folderView=({account_id:_owner,...row}:Folder)=>row;
const shareView=({account_id:_owner,...row}:Share)=>row;
export function folderName(body:unknown) {const {name}=nameInput.parse(body);return {name:z.string().max(80).parse(name.normalize('NFC')),key:z.string().max(240).parse(name.normalize('NFKC').toLowerCase())};}
export function photoQuery(query:unknown) {
 const input=queryInput.parse(query);let cursor:{at:Date;id:string}|undefined;
 if(input.cursor){const decoded=Buffer.from(input.cursor,'base64url').toString();const match=/^([^|]+)\|([a-f0-9]{32})$/.exec(decoded);if(!match||!Number.isFinite(Date.parse(match[1])))throw new AppError(422,'CURSOR_INVALID','Cursor tidak valid.');cursor={at:new Date(match[1]),id:match[2]};}
 return {...input,folder_id:input.folder_id==='unfiled'?null:input.folder_id,cursor};
}
export class PhotoFolderService {
 constructor(readonly model:PhotoFolderModel,private readonly results:CustomerResultService,private readonly publicOrigin:string){}
 list(accountId:string){return this.model.list(accountId);}
 async create(accountId:string,body:unknown){const n=folderName(body);return folderView(await this.model.create(accountId,n.name,n.key));}
 async rename(accountId:string,folderId:string,body:unknown){const n=folderName(body);return folderView(await this.model.rename(accountId,id.parse(folderId),n.name,n.key));}
 remove(accountId:string,folderId:string){return this.model.remove(accountId,id.parse(folderId));}
 async default(accountId:string,body:unknown){const {folder_id}=destination.parse(body);await this.model.default(accountId,folder_id);return {default_folder_id:folder_id};}
 async move(accountId:string,resultId:string,body:unknown){const {folder_id}=destination.parse(body);await this.model.move(accountId,id.parse(resultId),folder_id);return {result_id:resultId,folder_id};}
 private page(rows:Photo[],limit:number,url:(row:Photo)=>string){const page=rows.slice(0,limit),last=page.at(-1);return {photos:page.map(({id,...row})=>({result_id:id,...row,image_url:url({id,...row})+'/image',download_url:url({id,...row})+'/download'})),next_cursor:rows.length>limit&&last?Buffer.from(last.created_at.toISOString()+'|'+last.id).toString('base64url'):null};}
 async photos(accountId:string,query:unknown,base='/api/results'){const q=photoQuery(query);return this.page(await this.model.photos(accountId,q),q.limit,row=>`${base}/${row.id}`);}
 async shares(accountId:string,folderId:string){return {shares:(await this.model.shares(accountId,id.parse(folderId))).map(shareView)};}
 async createShare(accountId:string,folderId:string,body:unknown){
  const input=z.object({expires_at:z.string().datetime()}).strict().parse(body),expiry=new Date(input.expires_at);const duration=expiry.getTime()-Date.now();
  if(duration<60000||duration>90*86400000)throw new AppError(422,'PHOTO_FOLDER_SHARE_EXPIRY','Masa link antara 1 menit dan 90 hari.');
  let origin:string;try{const url=new URL(this.publicOrigin);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error();origin=url.origin;}catch{throw new AppError(503,'PHOTO_FOLDER_SHARE_ORIGIN_UNAVAILABLE','Alamat publik folder belum dikonfigurasi.');}
  const token=randomBytes(32).toString('base64url');const row=await this.model.createShare(accountId,id.parse(folderId),tokenHash(token),expiry);
  return {...shareView(row),mode:'live',share_url:`${origin}/s/${token}`};
 }
 revoke(accountId:string,shareId:string){return this.model.revoke(accountId,id.parse(shareId));}
 private async resolve(token:string){if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new AppError(404,'PHOTO_FOLDER_SHARE_UNAVAILABLE','Folder berbagi tidak tersedia.');return this.model.shared(tokenHash(token));}
 async shared(token:string,query:unknown){const share=await this.resolve(token),q=photoQuery(query);if(q.folder_id!==undefined)throw new AppError(422,'VALIDATION_FAILED','Folder sudah ditentukan oleh link.');
  const page=this.page(await this.model.photos(share.account_id,{...q,folder_id:share.folder_id}),q.limit,row=>`/api/public/photo-folders/${token}/photos/${row.id}`);
  return {folder:{name:share.name},expires_at:share.expires_at,mode:'live',...page};
 }
 async media(token:string,resultId:string){const share=await this.resolve(token);await this.model.contains(share.account_id,share.folder_id,id.parse(resultId));
  const identity:CustomerIdentity={account:{id:share.account_id} as NxAccount,guest:null,clearAccount:false,newGuest:null,sessionId:'folder-share'};
  return this.results.owned(resultId,identity);
 }
 async bytes(token:string,resultId:string){const found=await this.media(token,resultId);return {bytes:await this.results.bytes(found.result,true),content_type:found.result.content_type};}
}

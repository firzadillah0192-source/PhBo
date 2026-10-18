import { Prisma, type PrismaClient } from '@prisma/client';
import { AppError } from '../lib/errors.js';
import { legacyId } from '../services/customer-credentials.service.js';
type Tx = Prisma.TransactionClient;
export type Folder = { id: string; account_id: string; name: string; created_at: Date; updated_at: Date };
export type Photo = { id: string; job_id: string; mode: string; folder_id: string | null; created_at: Date; expires_at: Date; content_type: string; size_bytes: number; width: number; height: number };
export type Share = { id: string; account_id: string; folder_id: string; expires_at: Date; revoked_at: Date | null; created_at: Date };
export type PhotoQuery = { folder_id?: string | null; limit: number; cursor?: { at: Date; id: string } };
const missing = () => new AppError(404, 'PHOTO_FOLDER_NOT_FOUND', 'Folder tidak tersedia.');
// Only final, owned, paid, non-kiosk, unexpired results are visible. These are
// metadata queries; file delivery still uses CustomerResultService authorization.
const visible = (accountId: string) => Prisma.sql`j.account_id=${accountId} AND j.kiosk_session_id IS NULL AND j.state='COMPLETED' AND r.deleted_at IS NULL AND (c.status IS NULL OR c.status='PAID') AND COALESCE(p.expires_at,r.created_at+interval '14 days')>now()`;
const joins = Prisma.sql`FROM results r JOIN generation_jobs j ON j.id=r.job_id LEFT JOIN generation_credit_charges c ON c.job_id=j.id LEFT JOIN subscription_v2_results p ON p.result_id=r.id LEFT JOIN photo_folder_results m ON m.result_id=r.id AND m.account_id=j.account_id LEFT JOIN photo_folders f ON f.id=m.folder_id AND f.account_id=j.account_id AND f.deleted_at IS NULL`;
export class PhotoFolderModel {
 constructor(private readonly db: PrismaClient) {}
 async lock(tx: Tx, accountId: string) { await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'folders:'+accountId},260))::text`; }
 async folderIn(tx: Tx, accountId: string, id: string) {
  const [row] = await tx.$queryRaw<Folder[]>`SELECT id,account_id,name,created_at,updated_at FROM photo_folders WHERE id=${id} AND account_id=${accountId} AND deleted_at IS NULL`;
  if (!row) throw missing(); return row;
 }
 async list(accountId: string) {
  const folders = await this.db.$queryRaw<(Folder & { count: number })[]>`SELECT outer_folder.id,outer_folder.account_id,outer_folder.name,outer_folder.created_at,outer_folder.updated_at,(SELECT count(*)::int ${joins} WHERE ${visible(accountId)} AND m.folder_id=outer_folder.id) AS count FROM photo_folders outer_folder WHERE outer_folder.account_id=${accountId} AND outer_folder.deleted_at IS NULL ORDER BY outer_folder.name_key,outer_folder.id`;
  const [pref] = await this.db.$queryRaw<{ default_folder_id: string | null }[]>`SELECT p.default_folder_id FROM photo_folder_preferences p JOIN photo_folders f ON f.id=p.default_folder_id AND f.account_id=p.account_id AND f.deleted_at IS NULL WHERE p.account_id=${accountId}`;
  return { folders: folders.map(({ account_id: _owner, ...f }) => f), default_folder_id: pref?.default_folder_id ?? null };
 }
 async create(accountId: string, name: string, key: string) {
  return this.db.$transaction(async tx => {
   await this.lock(tx,accountId);
   const [{ n }] = await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int n FROM photo_folders WHERE account_id=${accountId} AND deleted_at IS NULL`;
   if(n>=100) throw new AppError(409,'PHOTO_FOLDER_LIMIT','Maksimal 100 folder per akun.');
   const [duplicate] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM photo_folders WHERE account_id=${accountId} AND name_key=${key} AND deleted_at IS NULL`;
   if(duplicate) throw new AppError(409,'PHOTO_FOLDER_NAME_EXISTS','Nama folder sudah digunakan.');
   const [row] = await tx.$queryRaw<Folder[]>`INSERT INTO photo_folders(id,account_id,name,name_key) VALUES(${legacyId()},${accountId},${name},${key}) RETURNING id,account_id,name,created_at,updated_at`; return row;
  });
 }
 async rename(accountId: string,id: string,name: string,key: string) {
  return this.db.$transaction(async tx => {
   await this.lock(tx,accountId);await this.folderIn(tx,accountId,id);
   const [duplicate] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM photo_folders WHERE account_id=${accountId} AND name_key=${key} AND id<>${id} AND deleted_at IS NULL`;
   if(duplicate) throw new AppError(409,'PHOTO_FOLDER_NAME_EXISTS','Nama folder sudah digunakan.');
   const [row] = await tx.$queryRaw<Folder[]>`UPDATE photo_folders SET name=${name},name_key=${key},updated_at=now() WHERE id=${id} AND account_id=${accountId} RETURNING id,account_id,name,created_at,updated_at`;return row;
  });
 }
 async remove(accountId: string,id: string) {
  await this.db.$transaction(async tx => {
   await this.lock(tx,accountId);await this.folderIn(tx,accountId,id);
   await tx.$executeRaw`UPDATE photo_folder_preferences SET default_folder_id=NULL WHERE account_id=${accountId} AND default_folder_id=${id}`;
   await tx.$executeRaw`UPDATE generation_folder_destinations SET folder_id=NULL WHERE account_id=${accountId} AND folder_id=${id}`;
   await tx.$executeRaw`UPDATE photo_folder_results SET folder_id=NULL WHERE account_id=${accountId} AND folder_id=${id}`;
   await tx.$executeRaw`UPDATE photo_folder_shares SET revoked_at=COALESCE(revoked_at,now()) WHERE account_id=${accountId} AND folder_id=${id}`;
   await tx.$executeRaw`UPDATE photo_folders SET deleted_at=now(),updated_at=now() WHERE id=${id} AND account_id=${accountId}`;
  });
 }
 async default(accountId: string,folderId: string | null) {
  await this.db.$transaction(async tx => { await this.lock(tx,accountId);if(folderId)await this.folderIn(tx,accountId,folderId);await tx.$executeRaw`INSERT INTO photo_folder_preferences(account_id,default_folder_id) VALUES(${accountId},${folderId}) ON CONFLICT(account_id) DO UPDATE SET default_folder_id=EXCLUDED.default_folder_id`; });
 }
 async reserveIn(tx: Tx,accountId: string,jobId: string,requested: string | null | undefined) {
  await this.lock(tx,accountId);let folderId=requested;
  if(folderId===undefined) {
   const [pref]=await tx.$queryRaw<{ default_folder_id: string | null }[]>`SELECT p.default_folder_id FROM photo_folder_preferences p JOIN photo_folders f ON f.id=p.default_folder_id AND f.account_id=p.account_id AND f.deleted_at IS NULL WHERE p.account_id=${accountId}`;folderId=pref?.default_folder_id ?? null;
  }
  if(folderId)await this.folderIn(tx,accountId,folderId);
  await tx.$executeRaw`INSERT INTO generation_folder_destinations(job_id,account_id,folder_id) VALUES(${jobId},${accountId},${folderId ?? null})`;
 }
 async completeIn(tx: Tx,jobId: string,resultId: string,accountId: string | null) {
  if(!accountId)return;
  await this.lock(tx,accountId);
  await tx.$executeRaw`INSERT INTO photo_folder_results(result_id,account_id,folder_id) SELECT ${resultId},d.account_id,f.id FROM generation_folder_destinations d LEFT JOIN photo_folders f ON f.id=d.folder_id AND f.account_id=d.account_id AND f.deleted_at IS NULL WHERE d.job_id=${jobId} AND d.account_id=${accountId} ON CONFLICT(result_id) DO NOTHING`;
 }
 async move(accountId: string,resultId: string,folderId: string | null) {
  await this.db.$transaction(async tx=>{
   await this.lock(tx,accountId);if(folderId)await this.folderIn(tx,accountId,folderId);
   const [photo]=await tx.$queryRaw<{ id: string }[]>`SELECT r.id ${joins} WHERE ${visible(accountId)} AND r.id=${resultId} FOR UPDATE OF r`;
   if(!photo)throw new AppError(404,'RESULT_NOT_FOUND','Foto tidak tersedia.');
   await tx.$executeRaw`INSERT INTO photo_folder_results(result_id,account_id,folder_id) VALUES(${resultId},${accountId},${folderId}) ON CONFLICT(result_id) DO UPDATE SET folder_id=EXCLUDED.folder_id,account_id=EXCLUDED.account_id`;
  });
 }
 async photos(accountId: string,query: PhotoQuery) {
  if(query.folder_id) await this.folderIn(this.db,accountId,query.folder_id);
  const filter=query.folder_id===undefined ? Prisma.empty : query.folder_id===null ? Prisma.sql`AND f.id IS NULL` : Prisma.sql`AND f.id=${query.folder_id}`;
  const cursor=query.cursor ? Prisma.sql`AND (r.created_at,r.id)<(${query.cursor.at},${query.cursor.id})` : Prisma.empty;
  return this.db.$queryRaw<Photo[]>`SELECT r.id,r.job_id,j.mode,f.id AS folder_id,r.created_at,COALESCE(p.expires_at,r.created_at+interval '14 days') AS expires_at,r.content_type,r.size_bytes,r.width,r.height ${joins} WHERE ${visible(accountId)} ${filter} ${cursor} ORDER BY r.created_at DESC,r.id DESC LIMIT ${query.limit+1}`;
 }
 async shares(accountId: string,folderId: string) {
  await this.folderIn(this.db,accountId,folderId);return this.db.$queryRaw<Share[]>`SELECT id,account_id,folder_id,expires_at,revoked_at,created_at FROM photo_folder_shares WHERE account_id=${accountId} AND folder_id=${folderId} ORDER BY created_at DESC LIMIT 100`;
 }
 async createShare(accountId: string,folderId: string,hash: string,expires: Date) {
  return this.db.$transaction(async tx=>{await this.lock(tx,accountId);await this.folderIn(tx,accountId,folderId);
   const [{ n }] = await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int n FROM photo_folder_shares WHERE account_id=${accountId} AND folder_id=${folderId} AND revoked_at IS NULL AND expires_at>now()`;
   if(n>=20)throw new AppError(409,'PHOTO_FOLDER_SHARE_LIMIT','Maksimal 20 link aktif per folder.');
   const [row]=await tx.$queryRaw<Share[]>`INSERT INTO photo_folder_shares(id,account_id,folder_id,token_hash,expires_at) VALUES(${legacyId()},${accountId},${folderId},${hash},${expires}) RETURNING id,account_id,folder_id,expires_at,revoked_at,created_at`;return row;});
 }
 async revoke(accountId: string,id: string) {
  await this.db.$transaction(async tx=>{await this.lock(tx,accountId);const n=await tx.$executeRaw`UPDATE photo_folder_shares SET revoked_at=COALESCE(revoked_at,now()) WHERE id=${id} AND account_id=${accountId}`;if(!n)throw missing();});
 }
 async shared(hash: string) {
  const [row]=await this.db.$queryRaw<(Share & { name: string })[]>`SELECT s.id,s.account_id,s.folder_id,s.expires_at,s.revoked_at,s.created_at,f.name FROM photo_folder_shares s JOIN photo_folders f ON f.id=s.folder_id AND f.account_id=s.account_id JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=${hash} AND s.revoked_at IS NULL AND s.expires_at>now() AND f.deleted_at IS NULL AND a.status='active'`;
  if(!row)throw new AppError(404,'PHOTO_FOLDER_SHARE_UNAVAILABLE','Folder berbagi tidak tersedia.');return row;
 }
 async contains(accountId: string,folderId: string,resultId: string) {
  const [row]=await this.db.$queryRaw<{ id: string }[]>`SELECT r.id ${joins} WHERE ${visible(accountId)} AND f.id=${folderId} AND r.id=${resultId}`;
  if(!row)throw new AppError(404,'RESULT_NOT_FOUND','Foto tidak tersedia.');
 }
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { NativeObjectStorage } from '../src/services/native-object-storage.service.js';
import { CatalogAssetsService } from '../src/services/catalog-assets.service.js';
import { NativeStorageMigration } from '../src/services/native-storage-migration.service.js';
import { AdminCatalogService } from '../src/services/admin-catalog.service.js';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const files = new Map<string, { bytes: Buffer; metadata: Record<string,string> }>();
  const objects = new NativeObjectStorage({
    async putObject(_bucket: string, key: string, bytes: Buffer, _size: number, metadata: Record<string,string>) { files.set(key, { bytes, metadata }); },
    async getObject(_bucket: string, key: string) { return Readable.from([files.get(key)!.bytes]); },
    async statObject(_bucket: string, key: string) { const row=files.get(key);if (!row) throw Object.assign(new Error(),{code:'NoSuchKey'}); return { size:row.bytes.length,etag:hash(row.bytes),lastModified:new Date(),metaData:{'nxbooth-source-mtime':row.metadata['X-Amz-Meta-Nxbooth-Source-Mtime']} }; },
    async removeObject(_bucket: string, key: string) { files.delete(key); },async bucketExists(){return true;},
  } as never, 'synthetic-test');
  return { objects, files };
}

test('catalog aliases read MinIO, cache refreshes after replacement, and keys reject traversal', async () => {
  const root = await mkdtemp(join(tmpdir(),'nxbooth-catalog-object-test-'));
  try {
    const { objects }=fixture();const assets=new CatalogAssetsService([root],root,objects,join(root,'.cache'));
    const target=join(root,'demo','preview.png');const first=Buffer.from('first');const second=Buffer.from('second');
    const ref=await assets.store(target,first);assert.equal(ref,'minio://catalog/demo/preview.png');
    const file=await assets.file(target);assert.deepEqual(await readFile(file!),first);
    await assets.store(target,second);const changed=await assets.file(ref);assert.notEqual(changed,file);assert.deepEqual(await readFile(changed!),second);
    assert.equal(await assets.store('/etc/passwd',first),null);
    for(const name of ['../secret','folder/../../secret','folder//bad','folder/./bad'])assert.throws(()=>objects.catalogReference(name));
    await assets.removeObject(ref!);assert.equal(await assets.file(ref),null);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('Admin writes validated images to catalog objects without creating a disk master',async()=>{
  const root=await mkdtemp(join(tmpdir(),'nxbooth-admin-object-test-'));
  try{
    const {objects}=fixture();const assets=new CatalogAssetsService([root],root,objects,join(root,'.cache'));
    const admin=new AdminCatalogService({} as never,assets,{templatesDir:root,tmpDir:join(root,'tmp'),minDimension:16,maxDimension:2000});
    const bytes=await sharp({create:{width:30,height:60,channels:3,background:'red'}}).png().toBuffer();
    const target=join(root,'demo','template.png');const ref=await admin.saveImage({buffer:bytes,mimetype:'image/png'} as never,target);
    assert.equal(ref,'minio://catalog/demo/template.png');assert.deepEqual(await objects.read(ref),bytes);
    await assert.rejects(readFile(target));
    await assert.rejects(admin.saveImage({buffer:Buffer.from('bad'),mimetype:'image/png'} as never,target));
  }finally{await rm(root,{recursive:true,force:true});}
});

test('backfill dry-run is read-only, verifies hashes before CAS, preserves source files and is idempotent',async()=>{
  const root=await mkdtemp(join(tmpdir(),'nxbooth-backfill-test-'));
  try{
    const {objects,files}=fixture();const templateDir=join(root,'templates');const resultDir=join(root,'results','ab');
    await mkdir(templateDir,{recursive:true});await mkdir(resultDir,{recursive:true});
    const bytes=Buffer.from('synthetic-result');const id='ab'+'1'.repeat(30);const path=join(resultDir,`${id}.png`);
    await writeFile(path,bytes);await writeFile(join(templateDir,'template.json'),'{}');
    const row={id,storage_path:path,size_bytes:bytes.length,sha256:hash(bytes),content_type:'image/png',deleted_at:null};
    let changes=0;
    const db={nxResult:{async findMany(){return [row];},async updateMany({where,data}:any){assert.equal(where.storage_path,path);changes++;row.storage_path=data.storage_path;return {count:1};}},nxUpload:{async findMany(){return [];}}};
    const migration=new NativeStorageMigration(db as never,objects,{runtimeDir:root,templatesDir:templateDir,retentionHours:24});
    const dry=await migration.run();assert.equal(dry.results_verified,1);assert.equal(files.size,0);assert.equal(changes,0);
    const applied=await migration.run(true);assert.equal(applied.refs_changed,1);assert.match(row.storage_path,/^minio:\/\/results/);assert.deepEqual(await readFile(path),bytes);
    const again=await migration.run(true);assert.equal(again.refs_already_minio,1);assert.equal(again.refs_changed,0);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('backfill refuses corrupt source or conflicting object and does not resurrect a deleted result',async()=>{
  const root=await mkdtemp(join(tmpdir(),'nxbooth-backfill-reject-test-'));
  try{
    const {objects,files}=fixture();const templates=join(root,'templates');const results=join(root,'results');await mkdir(templates);await mkdir(results);
    const id='ab'+'2'.repeat(30);const source=join(results,`${id}.png`);const bytes=Buffer.from('synthetic');await writeFile(source,bytes);
    const row={id,storage_path:source,size_bytes:bytes.length,sha256:'bad',content_type:'image/png',deleted_at:null};
    let updated=false;
    const db={nxResult:{async findMany(){return [row];},async updateMany(){updated=true;return {count:0};},async findUnique(){return {...row,deleted_at:new Date()};}},nxUpload:{async findMany(){return [];}}};
    const migration=new NativeStorageMigration(db as never,objects,{runtimeDir:root,templatesDir:templates,retentionHours:24});
    assert.equal((await migration.run(true)).conflicts,1);assert.equal(updated,false);assert.equal(files.size,0);
    row.sha256=hash(bytes);const ref=objects.reference('results',id);await objects.put(ref,Buffer.from('conflict'),'image/png');
    assert.equal((await migration.run(true)).conflicts,1);assert.equal(updated,false);
    await objects.remove(ref);assert.equal((await migration.run(true)).concurrent_changes,1);assert.equal(files.size,0);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('upload backfill guards expiry/path/hash without relying on JavaScript timestamp precision',async()=>{
  const root=await mkdtemp(join(tmpdir(),'nxbooth-upload-backfill-test-'));
  try{
    const {objects}=fixture();const templates=join(root,'templates');const uploads=join(root,'uploads');await mkdir(templates);await mkdir(uploads);
    const id='ab'+'3'.repeat(30);const source=join(uploads,`${id}.jpg`);const bytes=Buffer.from('canonical synthetic photo');await writeFile(source,bytes);
    const row={id,storage_path:source,size_bytes:bytes.length,sha256:hash(bytes),content_type:'image/jpeg',created_at:new Date(),validation_status:'VALID'};
    const db={nxResult:{async findMany(){return [];}},nxUpload:{async findMany(){return [row];},async updateMany({where,data}:any){assert.equal(where.created_at.equals,undefined);assert.ok(where.created_at.gt instanceof Date);assert.equal(where.sha256,row.sha256);assert.equal(where.storage_path,source);row.storage_path=data.storage_path;return {count:1};}}};
    const report=await new NativeStorageMigration(db as never,objects,{runtimeDir:root,templatesDir:templates,retentionHours:24}).run(true);
    assert.equal(report.uploads_verified,1);assert.equal(report.refs_changed,1);assert.equal(report.concurrent_changes,0);assert.match(row.storage_path,/^minio:\/\/uploads/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('newer catalog JSON sync keeps verified history while image conflicts stay rejected',async()=>{
  const root=await mkdtemp(join(tmpdir(),'nxbooth-metadata-sync-test-'));
  try{
    const {objects,files}=fixture();const old=Buffer.from('{"version":1}');const current=Buffer.from('{"version":2}');
    await writeFile(join(root,'template.json'),current);await objects.put(objects.catalogReference('template.json'),old,'application/json',1000);
    await writeFile(join(root,'frame.png'),'new-frame');await objects.put(objects.catalogReference('frame.png'),Buffer.from('old-frame'),'image/png',1000);
    const db={nxResult:{async findMany(){return [];}},nxUpload:{async findMany(){return [];}}};
    const migration=new NativeStorageMigration(db as never,objects,{runtimeDir:root,templatesDir:root,retentionHours:24});
    const report=await migration.run(true,true);assert.equal(report.catalog_verified,1);assert.equal(report.conflicts,1);
    assert.deepEqual(await objects.read(objects.catalogReference('template.json')),current);
    assert.deepEqual(await objects.read(objects.catalogReference(`_history/${hash(old)}/template.json`)),old);
    assert.deepEqual(files.get('catalog/frame.png')!.bytes,Buffer.from('old-frame'));
  }finally{await rm(root,{recursive:true,force:true});}
});

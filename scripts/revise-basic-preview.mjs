// Run via stdin from /app in the API. Replaces only marketing_preview_path of the Basic templates with
// previews that show the finished footer. Never overwrites existing objects; no schema change.
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'minio';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { migrationConfigSchema } from './dist/config/migration-env.js';
import { NativeObjectStorage } from './dist/services/native-object-storage.service.js';
const config=migrationConfigSchema.parse(process.env),directory=process.env.PREVIEW_RELEASE_DIR,action=process.env.PREVIEW_ACTION;
if(!/^\/srv\/photobooth\/releases\/basic-preview-\d{8}T\d{6}Z$/.test(directory||'')||!['snapshot','publish','rollback','verify'].includes(action))throw Error('Managed release/action required');
const db=new PrismaClient({adapter:new PrismaPg({connectionString:config.DATABASE_URL})});
const ids=(await readdir(directory+'/assets')).sort();if(ids.length!==16)throw Error('Expected 16 previews');
const save=async(name,data,exclusive=false)=>writeFile(directory+'/'+name,JSON.stringify(data,null,2)+'\n',{mode:0o600,...(exclusive?{flag:'wx'}:{})});
try {
 const rows=await db.nxTemplate.findMany({where:{id:{in:ids}},orderBy:{id:'asc'},select:{id:true,marketing_preview_path:true}});
 if(rows.length!==16)throw Error('Template set changed');
 if(action==='snapshot'){await save('catalog-before.json',rows,true);console.log('PASS snapshot 16 preview paths');}
 else {
  const before=JSON.parse(await readFile(directory+'/catalog-before.json','utf8'));
  const objects=new NativeObjectStorage(new Client({endPoint:config.MINIO_ENDPOINT,port:config.MINIO_PORT,useSSL:config.MINIO_USE_SSL,accessKey:config.MINIO_ACCESS_KEY,secretKey:config.MINIO_SECRET_KEY,region:config.MINIO_REGION}),config.MINIO_BUCKET);
  const revision=directory.split('/').at(-1);
  const desired=before.map(row=>({id:row.id,marketing_preview_path:objects.catalogReference(`${row.id}/${revision}/preview.png`)}));
  if(action==='publish')for(const row of desired){
   const bytes=await readFile(directory+'/assets/'+row.id+'/preview.png');const meta=await sharp(bytes).metadata();
   if(meta.width!==256||meta.height!==384)throw Error('Invalid dimensions');
   await objects.put(row.marketing_preview_path,bytes,'image/png');
   if(createHash('sha256').update(await objects.read(row.marketing_preview_path)).digest('hex')!==createHash('sha256').update(bytes).digest('hex'))throw Error('Object readback differs');
  }
  if(action==='verify'){for(const wanted of desired){if(rows.find(r=>r.id===wanted.id)?.marketing_preview_path!==wanted.marketing_preview_path)throw Error('Catalog differs');}}
  else {
   const expected=action==='publish'?before:desired,replacement=action==='publish'?desired:before;
   await db.$transaction(async tx=>{for(const row of replacement){const original=expected.find(r=>r.id===row.id);const changed=await tx.nxTemplate.updateMany({where:{id:row.id,marketing_preview_path:original.marketing_preview_path},data:{marketing_preview_path:row.marketing_preview_path}});if(changed.count!==1)throw Error('Concurrent catalog edit; rolled back');}});
   await save(action==='publish'?'catalog-after.json':'catalog-rollback.json',replacement);
  }
  console.log(JSON.stringify({status:'PASS',action,templates:16}));
 }
}finally{await db.$disconnect();}

// Run via stdin from /app in the API. Never overwrites v1 objects or schema.
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'minio';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { migrationConfigSchema } from './dist/config/migration-env.js';
import { NativeObjectStorage } from './dist/services/native-object-storage.service.js';
const config=migrationConfigSchema.parse(process.env),directory=process.env.FOOTER_RELEASE_DIR,action=process.env.FOOTER_ACTION;
if(!/^\/srv\/photobooth\/releases\/basic-footer-\d{8}T\d{6}Z$/.test(directory||'')||!['snapshot','publish','rollback','verify'].includes(action))throw Error('Managed release/action required');
const db=new PrismaClient({adapter:new PrismaPg({connectionString:config.DATABASE_URL})});
const collection=JSON.parse(await readFile(directory+'/assets/collection.json','utf8'));
const ids=collection.templates.map(t=>t.id);if(ids.length!==16||new Set(ids).size!==16)throw Error('Expected 16 templates');
const keys=['image_path','marketing_preview_path','metadata_path','enabled'];
const fields=row=>Object.fromEntries(keys.map(k=>[k,row[k]]));
const save=async(name,data,exclusive=false)=>writeFile(directory+'/'+name,JSON.stringify(data,null,2)+'\n',{mode:0o600,...(exclusive?{flag:'wx'}:{})});
try {
 const rows=await db.nxTemplate.findMany({where:{id:{in:ids}},orderBy:{id:'asc'}});
 if(rows.length!==16||rows.some(r=>!r.enabled&&r.id!=='sci-fi-space-commander-001'))throw Error('Active template set changed');
 if(action==='snapshot'){await save('catalog-before.json',rows,true);console.log('PASS snapshot 16 catalog rows; enabled states preserved');}
 else {
  const before=JSON.parse(await readFile(directory+'/catalog-before.json','utf8'));
  const objects=new NativeObjectStorage(new Client({endPoint:config.MINIO_ENDPOINT,port:config.MINIO_PORT,useSSL:config.MINIO_USE_SSL,accessKey:config.MINIO_ACCESS_KEY,secretKey:config.MINIO_SECRET_KEY,region:config.MINIO_REGION}),config.MINIO_BUCKET);
  const revision=directory.split('/').at(-1);
  const desired=before.map(row=>({...row,enabled:true,image_path:objects.catalogReference(`${row.id}/${revision}/template.png`),marketing_preview_path:objects.catalogReference(`${row.id}/${revision}/preview.png`),metadata_path:objects.catalogReference(`${row.id}/${revision}/template.json`)}));
  if(action==='publish')for(const row of desired){
   for(const [key,name] of [['image_path','template.png'],['marketing_preview_path','preview.png'],['metadata_path','template.json']]){
    const bytes=await readFile(directory+'/assets/'+row.id+'/'+name);
    if(name.endsWith('.png')){const meta=await sharp(bytes).metadata();if(meta.width!==(name==='template.png'?1024:256)||meta.height!==(name==='template.png'?1536:384))throw Error('Invalid dimensions');}
    await objects.put(row[key],bytes,name.endsWith('.png')?'image/png':'application/json');
    if(createHash('sha256').update(await objects.read(row[key])).digest('hex')!==createHash('sha256').update(bytes).digest('hex'))throw Error('Object readback differs');
   }
  }
  if(action==='verify'){
   for(const wanted of desired){const row=rows.find(r=>r.id===wanted.id);if(JSON.stringify(fields(row))!==JSON.stringify(fields(wanted)))throw Error('Catalog differs');}
  } else {
   const expected=action==='publish'?before:desired,replacement=action==='publish'?desired:before;
   await db.$transaction(async tx=>{for(const row of replacement){const original=expected.find(r=>r.id===row.id);const changed=await tx.nxTemplate.updateMany({where:{id:row.id,...fields(original)},data:fields(row)});if(changed.count!==1)throw Error('Concurrent catalog edit; rolled back');}});
   await save(action==='publish'?'catalog-after.json':'catalog-rollback.json',replacement);
  }
  console.log(JSON.stringify({status:'PASS',action,templates:16,v1_unchanged:true}));
 }
}finally{await db.$disconnect();}

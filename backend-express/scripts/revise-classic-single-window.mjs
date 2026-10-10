// Executed via stdin inside the active API. No schema changes or old asset deletes.
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'minio';
import { readFile, writeFile } from 'node:fs/promises';
import { migrationConfigSchema } from './dist/config/migration-env.js';
import { NativeObjectStorage } from './dist/services/native-object-storage.service.js';
import { CatalogAssetsService } from './dist/services/catalog-assets.service.js';

const directory=process.env.CLASSIC_COLLECTION_RELEASE_DIR, action=process.env.CLASSIC_COLLECTION_ACTION;
if(!/^\/srv\/photobooth\/releases\/classic-single-window-\d{8}T\d{6}Z$/.test(directory||'')||!['snapshot','publish','rollback'].includes(action))throw Error('Explicit managed release/action required');
const collection=JSON.parse(await readFile(directory+'/assets/collection.json','utf8'));
if(collection.status!=='PASS'||collection.frames.length!==36)throw Error('Unreviewed collection');
const ids=collection.frames.map(r=>r.id);
if(new Set(ids).size!==36)throw Error('Duplicate frame IDs');
const keys=['frame_asset_path','layout_config_json','canvas_width','canvas_height','shot_count'];
const fields=row=>Object.fromEntries(keys.map(key=>[key,row[key]]));
const config=migrationConfigSchema.parse(process.env);
const db=new PrismaClient({adapter:new PrismaPg({connectionString:config.DATABASE_URL})});
try{
 const rows=await db.nxClassicLayout.findMany({where:{id:{in:ids}},orderBy:{id:'asc'}});
 if(rows.length!==36)throw Error('Catalog does not match the reviewed IDs');
 if(action==='snapshot'){
  await writeFile(directory+'/before.json',JSON.stringify(rows,null,2)+'\n',{flag:'wx',mode:0o600});
 }else{
  const before=JSON.parse(await readFile(directory+'/before.json','utf8'));
  const expected=action==='rollback'?JSON.parse(await readFile(directory+'/after.json','utf8')):before;
  if(expected.length!==36||ids.some(id=>!expected.find(row=>row.id===id)))throw Error('Incomplete snapshot');
  for(const row of rows)if(JSON.stringify(fields(row))!==JSON.stringify(fields(expected.find(r=>r.id===row.id))))throw Error('Catalog changed since snapshot');
  const replacements=new Map();
  if(action==='publish'){
   const objects=new NativeObjectStorage(new Client({endPoint:config.MINIO_ENDPOINT,port:config.MINIO_PORT,useSSL:config.MINIO_USE_SSL,accessKey:config.MINIO_ACCESS_KEY,secretKey:config.MINIO_SECRET_KEY,region:config.MINIO_REGION}),config.MINIO_BUCKET);
   const assets=new CatalogAssetsService([config.RUNTIME_DIR,config.TEMPLATES_DIR,directory],config.TEMPLATES_DIR,objects);
   const revision=directory.split('/').at(-1);
   for(const row of rows){
    const meta=collection.frames.find(r=>r.id===row.id);
    const layout=JSON.parse(await readFile(`${directory}/assets/${row.id}/layout.json`,'utf8'));
    if(JSON.stringify(layout)!==JSON.stringify(meta)||layout.canvas_width!==1200||layout.canvas_height!==3600||layout.shot_count!==3||layout.event_personalization!==true||layout.frame_geometry!=='single-window-v4'||JSON.stringify(layout.slots)!==JSON.stringify([0,1,2].map(i=>({x:60,y:106+844*i,width:1080,height:844,fit:'cover'})))||JSON.stringify(layout.photo_window)!==JSON.stringify({x:60,y:106,width:1080,height:2532}))throw Error('Unexpected frame contract');
    const data={frame_asset_path:objects.catalogReference(`${row.id}/${revision}/blank.png`),layout_config_json:JSON.stringify({...JSON.parse(row.layout_config_json),slots:layout.slots,event_personalization:true,photo_window:layout.photo_window,frame_geometry:'single-window-v4'}),canvas_width:1200,canvas_height:3600,shot_count:3};
    await assets.validateLayout({...row,...data,frame_asset_path:`${directory}/assets/${row.id}/blank.png`});
    replacements.set(row.id,data);
   }
   // Upload only new versioned keys, then validate before any catalog row changes.
   for(const row of rows){
    const data=replacements.get(row.id);
    await objects.put(data.frame_asset_path,await readFile(`${directory}/assets/${row.id}/blank.png`),'image/png');
    await objects.put(data.frame_asset_path.replace('/blank.png','/previews/blank.png'),await readFile(`${directory}/assets/${row.id}/preview.png`),'image/png');
    await assets.validateLayout({...row,...data});
   }
  }else for(const row of before)replacements.set(row.id,fields(row));
  const after=await db.$transaction(async tx=>{
   for(const row of expected){
    const update=await tx.nxClassicLayout.updateMany({where:{id:row.id,...fields(row)},data:replacements.get(row.id)});
    if(update.count!==1)throw Error('Concurrent catalog change; transaction rolled back');
   }
   return tx.nxClassicLayout.findMany({where:{id:{in:ids}},orderBy:{id:'asc'}});
  },{timeout:30000});
  await writeFile(directory+(action==='publish'?'/after.json':'/rollback.json'),JSON.stringify(after,null,2)+'\n',{mode:0o600});
 }
 console.log(JSON.stringify({status:'PASS',action,frames:36,schema_changed:false}));
}finally{await db.$disconnect()}

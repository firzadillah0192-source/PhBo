import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {Client} from 'minio';
import {readFile} from 'node:fs/promises';
import {migrationConfigSchema} from './dist/config/migration-env.js';
import {NativeObjectStorage} from './dist/services/native-object-storage.service.js';
import {CatalogAssetsService} from './dist/services/catalog-assets.service.js';
const config=migrationConfigSchema.parse(process.env);
const db=new PrismaClient({adapter:new PrismaPg({connectionString:config.DATABASE_URL})});
const assets=process.env.FLORAL_ASSET_DIR;
if(!assets)throw Error('Asset directory required');
const data=JSON.parse(await readFile(assets+'/layout.json','utf8'));
const objects=new NativeObjectStorage(new Client({endPoint:config.MINIO_ENDPOINT,port:config.MINIO_PORT,useSSL:config.MINIO_USE_SSL,accessKey:config.MINIO_ACCESS_KEY,secretKey:config.MINIO_SECRET_KEY,region:config.MINIO_REGION}),config.MINIO_BUCKET);
const service=new CatalogAssetsService([config.RUNTIME_DIR,config.TEMPLATES_DIR],config.TEMPLATES_DIR,objects);
try{
 const frame=objects.catalogReference('classic-floral-event-001/blank.png');
 const preview=objects.catalogReference('classic-floral-event-001/previews/blank.png');
 await objects.put(frame,await readFile(assets+'/blank.png'),'image/png');
 await objects.put(preview,await readFile(assets+'/preview.png'),'image/png');
 const row={id:data.id,slug:data.id,name:'Blue Floral · Nama Event',canvas_width:1200,canvas_height:3600,shot_count:3,layout_config_json:JSON.stringify({slots:data.slots,theme_slug:'personalized-events',theme_name:'Event Kamu'}),frame_asset_path:frame,active:true,sort_order:-1};
 await service.validateLayout(row);
 const existing=await db.nxClassicLayout.findUnique({where:{id:row.id}});
 if(existing&&(existing.frame_asset_path!==frame||existing.layout_config_json!==row.layout_config_json))throw Error('Existing layout differs; review before replacing');
 await db.nxClassicLayout.upsert({where:{id:row.id},create:row,update:{active:true,sort_order:-1}});
 console.log(JSON.stringify({status:'PASS',id:row.id,shots:3,dimensions:[1200,3600],registered:true}));
}finally{await db.$disconnect();}

import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Runtime} from '../shared/runtime.mjs';
import {origins,fetchCatalogImage} from '../shared/clients.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const catalog={frames:[{id:'classic-a',name:'Classic A',shot_count:3,requires_event_name:true,theme_name:'Event',preview_url:'/api/classic/layouts/classic-a/preview'}],
 templates:[{id:'tpl-a',name:'Tema A',enabled:true,basic_available:true,preview_url:'/api/templates/tpl-a/preview'},{id:'tpl-off',name:'Off',enabled:true,basic_available:false,preview_url:'/api/templates/tpl-off/preview'}],
 experiences:[{id:'exp-a',name:'Gaya A',category:'Design',enabled:true,thumbnail:'/api/experiences/exp-a/thumbnail'}]};
test('public catalog loads without a kiosk key, filters unavailable themes and serves allowlisted artwork only',async()=>{
 const seen=[];
 const server=createServer((req,res)=>{seen.push({url:req.url,key:req.headers['x-api-key']||null,cookie:req.headers.cookie||null});
  const m=req.url.match(/^\/api\/v1\/(frames|templates|experiences)$/);
  if(m){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:catalog[m[1]]}));return;}
  if(req.url==='/api/templates/tpl-a/preview'){res.setHeader('content-type','image/png');res.end(png);return;}
  res.statusCode=404;res.end('');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{
  const config=origins({control:base,media:base,storage:base,web:base},true);
  const runtime=new Runtime({journal:{all:()=>[],save:async()=>{},prints:()=>[]},bridge:{call:async()=>({simulated:false,camera:'BROWSER_WEBCAM',printing:{printer:'READY',printerName:'EPSON L8050 Series'}})},assets:'/nonexistent',origins:config,secrets:{persistent:false},publicCatalog:true});
  const state=await runtime.initialize();
  assert.equal(state.catalogLoaded,true);assert.equal(state.device.printerName,'EPSON L8050 Series');
  assert.deepEqual(state.catalog.BASIC.map(x=>x.id),['tpl-a']);assert.equal(state.catalog.CLASSIC[0].requiresEventName,true);assert.equal(state.catalog.ADVANCED[0].theme,'Design');
  assert.ok(seen.every(r=>r.key===null&&r.cookie===null));
  await assert.rejects(runtime.start('BASIC'),/SELECTION_REQUIRED/);
  assert.deepEqual(await runtime.catalogImage('BASIC','tpl-a'),png);
  await assert.rejects(runtime.catalogImage('BASIC','unknown'),/CATALOG_IMAGE_UNKNOWN/);
  await assert.rejects(fetchCatalogImage(config,'/api/account/me'),/CATALOG_IMAGE_FORBIDDEN/);
  await assert.rejects(fetchCatalogImage(config,'/api/templates/../account/preview'),/CATALOG_IMAGE_FORBIDDEN/);
  const off=new Runtime({journal:{all:()=>[],save:async()=>{},prints:()=>[]},bridge:{call:async()=>({})},assets:'/nonexistent',origins:config,secrets:{persistent:false}});
  await off.initialize();assert.equal((await off.state()).catalogLoaded,false);
 }finally{server.close();}
});

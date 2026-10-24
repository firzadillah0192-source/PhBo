import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CameraSettingsStore,DEFAULT_CAMERA_SETTINGS,bridgeSettings} from '../shared/camera-settings.mjs';
import {ISO_OPTIONS,OUTPUT_PRESETS,DEFAULT_OUTPUT} from '../shared/camera-options.mjs';

test('Camera settings default to leaving exposure to the camera, validate codes, survive restart and fall back when corrupt',async()=>{
 const root=await mkdtemp(join(tmpdir(),'nxbooth-camera-')),file=join(root,'camera.json');
 try{
  const store=new CameraSettingsStore(file);
  assert.deepEqual(await store.load(),DEFAULT_CAMERA_SETTINGS);
  assert.equal(DEFAULT_CAMERA_SETTINGS.iso,null);assert.equal(DEFAULT_CAMERA_SETTINGS.output,DEFAULT_OUTPUT);
  const saved=await store.save({iso:0x48,av:0x38,tv:0x70,output:'kecil'});
  assert.deepEqual(await new CameraSettingsStore(file).load(),saved);
  for(const bad of [{...saved,iso:1},{...saved,av:0x99},{...saved,tv:'1/125'},{...saved,output:'huge'},{...saved,extra:1},{iso:null,av:null,tv:null}])await assert.rejects(store.save(bad));
  assert.deepEqual(JSON.parse(await readFile(file,'utf8')),saved,'invalid saves keep the current settings');
  await writeFile(file,'broken');assert.deepEqual(await new CameraSettingsStore(file).load(),DEFAULT_CAMERA_SETTINGS);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('Bridge settings carry the codes and the resolved output size; ISO codes match the 2000D probe',()=>{
 assert.deepEqual(bridgeSettings({iso:0,av:null,tv:null,output:'hemat'}),{iso:0,av:null,tv:null,maxEdge:1280,quality:80});
 assert.deepEqual(bridgeSettings({iso:null,av:0x38,tv:0x70,output:'asli'}),{iso:null,av:0x38,tv:0x70,maxEdge:0,quality:90});
 assert.deepEqual(ISO_OPTIONS.map(o=>o.code),[0x00,0x48,0x50,0x58,0x60,0x68,0x70,0x78]);
 for(const preset of Object.values(OUTPUT_PRESETS)){assert.ok(preset.maxEdge===0||preset.maxEdge>=640&&preset.maxEdge<=6000);assert.ok(preset.quality>=50&&preset.quality<=95);}
});

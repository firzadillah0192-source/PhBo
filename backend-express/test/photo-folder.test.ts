import test from 'node:test';
import assert from 'node:assert/strict';
import { folderName,photoQuery } from '../src/services/photo-folder.service.js';
import { generationInput } from '../src/services/customer-generation-input.js';
import { generationRequest } from '../src/services/generation-request.js';
import { analyticsRoute } from '../src/services/analytics.service.js';
test('folder names normalize Unicode and reject controls and empty names',()=>{
 assert.deepEqual(folderName({name:'  CAFÉ  '}),{name:'CAFÉ',key:'café'});
 assert.equal(folderName({name:'Cafe\u0301'}).key,folderName({name:'CAFÉ'}).key);
 for(const name of ['', ' '.repeat(4),'bad\nname','x'.repeat(81),'a\u200b','\ufdfa'.repeat(80)])assert.throws(()=>folderName({name}));
 assert.throws(()=>folderName({name:'valid',account_id:'forged'}));
});
test('photo pagination validates bounded cursors/filter and accepts cache nonce',()=>{
 assert.equal(photoQuery({_request:'fixture',folder_id:'unfiled'}).folder_id,null);
 assert.throws(()=>photoQuery({cursor:'not-a-cursor'}));assert.throws(()=>photoQuery({limit:51}));
 assert.throws(()=>photoQuery({folder_id:'../../other'}));assert.throws(()=>photoQuery({account_id:'other'}));
});
test('folder changes participate in idempotency while omitted legacy input is stable',()=>{
 const identity={account:{id:'owner'},guest:null} as never;
 const input=generationInput.parse({mode:'BASIC',upload_id:'upload',template_id:'template'});
 const base=generationRequest('same-key',input,identity)!;
 assert.notEqual(generationRequest('same-key',{...input,folder_id:'a'.repeat(32)},identity)!.hash,base.hash);
 assert.notEqual(generationRequest('same-key',{...input,folder_id:null},identity)!.hash,base.hash);
 assert.equal(generationRequest('same-key',input,identity)!.hash,base.hash);
 assert.throws(()=>generationInput.parse({...input,folder_id:'other/invalid'}));
});
test('folder share tokens are redacted from analytics paths',()=>{
 assert.equal(analyticsRoute('/api/public/photo-folders/private-token/photos/id/download?key=secret'),'/api/public/photo-folders/:token/photos/id/download');
 assert.equal(analyticsRoute('/s/private-token'),'/s/:token');
});

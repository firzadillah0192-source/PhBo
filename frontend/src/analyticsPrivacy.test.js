import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeAnalyticsEvent,analyticsRoute} from './analyticsPrivacy.js';
test('photo, prompts, email and claim tokens are excluded',()=>{
 const event=sanitizeAnalyticsEvent({event:'phbo_qr_ready',properties:{email:'secret@example.invalid',prompt:'secret prompt',image:'data:image/private',token:'secret-claim',route:'/r/secret-claim?key=private',mode:'CLASSIC',$set:{email:'secret@example.invalid'}}});
 assert.equal(event.properties.route,'/r/:token');assert.equal(event.properties.mode,'CLASSIC');
 assert.deepEqual(event.properties.$set,{app:'phbo'});assert.doesNotMatch(JSON.stringify(event),/secret|private/);
});
test('exceptions preserve frame locations without messages, context or locals',()=>{
 const event=sanitizeAnalyticsEvent({properties:{$exception_list:[{type:'Error',value:'secret-photo-url',stacktrace:{frames:[{filename:'https://example.invalid/assets/app.js?token=secret',lineno:12,colno:3,vars:{email:'secret'},context_line:'secret'}]}}]}});
 assert.equal(event.properties.$exception_list[0].stacktrace.frames[0].lineno,12);assert.doesNotMatch(JSON.stringify(event),/secret|context_line|vars/);
});
test('route normalization removes query, public token and job identifier',()=>{
 assert.equal(analyticsRoute('/api/generations/private-id?token=secret'),'/api/generations/:id');
 assert.equal(analyticsRoute('/claim/private#secret'),'/claim/:token');
});

test('SDK top-level person properties cannot bypass privacy filtering',()=>{
 const event=sanitizeAnalyticsEvent({event:'$set',$set_once:{$initial_current_url:'/r/private-token?email=private'},$set:{email:'private'},properties:{distinct_id:'phbo-account:owner'}});
 assert.doesNotMatch(JSON.stringify(event),/private/);assert.deepEqual(event.$set_once,{app:'phbo'});assert.equal(event.properties.distinct_id,'phbo-account:owner');
});

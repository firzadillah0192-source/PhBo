import test from 'node:test'
import assert from 'node:assert/strict'
import {exploreStorageApi} from './api.js'
import {parseCustomerRoute,accountTabRoute} from './customerRoute.js'
const token='nxb_live_'+'a'.repeat(16)+'_'+'b'.repeat(43)
test('Developer routes are explicit and account tab can be linked',()=>{
 assert.equal(parseCustomerRoute('/developers').name,'developers')
 assert.equal(parseCustomerRoute('/account','?tab=developer').tab,'developer')
 assert.equal(accountTabRoute('developer'),'/account?tab=developer')
})
test('Explorer rejects arbitrary destinations and malformed keys before fetch',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('not expected')}
 try{await assert.rejects(exploreStorageApi({token:'bad',endpoint:'folders'}));await assert.rejects(exploreStorageApi({token,endpoint:'https://evil.invalid'}));await assert.rejects(exploreStorageApi({token,endpoint:'download',resultId:'../../secret'}));assert.equal(calls,0)}finally{globalThis.fetch=original}
})
test('Explorer sends key only in header, omits cookies and refuses redirects',async()=>{
 const original=globalThis.fetch;let seen
 globalThis.fetch=async(url,options)=>{seen={url,options};return new Response(JSON.stringify({photos:[],next_cursor:null}),{status:200})}
 try{const result=await exploreStorageApi({token,endpoint:'photos',folderId:'unfiled',cursor:'next+page'});assert.equal(result.status,200);assert.equal(seen.options.credentials,'omit');assert.equal(seen.options.redirect,'error');assert.equal(seen.options.referrerPolicy,'no-referrer');assert.equal(seen.options.headers.Authorization,'Bearer '+token);assert.ok(!seen.url.includes(token));assert.match(seen.url,/^\/api\/public\/v1\/storage\/photos\?/);assert.equal(new URL(seen.url,'https://test.invalid').searchParams.get('cursor'),'next+page')}finally{globalThis.fetch=original}
})
test('Explorer does not echo an upstream error body or credentials',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({secret:token}),{status:401})
 try{await assert.rejects(exploreStorageApi({token,endpoint:'folders'}),error=>!error.message.includes(token)&&error.message.includes('dicabut'))}finally{globalThis.fetch=original}
})

test('Generation Explorer reuses explicit idempotency key and never sends cookies',async()=>{
 const {exploreGenerationApi}=await import('./api.js');const original=globalThis.fetch;const seen=[]
 globalThis.fetch=async(url,options)=>{seen.push({url,options});return new Response(JSON.stringify({job_id:'c'.repeat(32),state:'QUEUED'}),{status:202})}
 try{const request={token,action:'generate',requestKey:'retry-stable-1',body:{template_id:'template',input_id:'input'}};await exploreGenerationApi(request);await exploreGenerationApi(request);assert.ok(seen.every(r=>r.options.headers['Idempotency-Key']==='retry-stable-1'&&r.options.credentials==='omit'&&r.options.redirect==='error'));assert.equal(seen[0].options.body,seen[1].options.body);assert.ok(!seen[0].url.includes(token));await assert.rejects(exploreGenerationApi({...request,action:'https://evil.invalid'}));assert.equal(seen.length,2)}finally{globalThis.fetch=original}
})
test('Generation Explorer uploads FormData and sanitizes errors without echoing raw body',async()=>{
 const {exploreGenerationApi}=await import('./api.js');const original=globalThis.fetch;let seen
 globalThis.fetch=async(url,options)=>{seen={url,options};return new Response(JSON.stringify({detail:{error_code:'CREDIT_BALANCE_EXHAUSTED',message:token}}),{status:403})}
 try{await assert.rejects(exploreGenerationApi({token,action:'upload',file:new Blob(['synthetic'],{type:'image/png'})}),e=>e.definitiveRejection&&!e.message.includes(token));assert.ok(seen.options.body instanceof FormData);assert.equal(seen.options.headers['Content-Type'],undefined)}finally{globalThis.fetch=original}
})

test('developer dashboard requests use account session and encode filters without account override',async()=>{
 const {getDeveloperDashboard,getDeveloperGenerations}=await import('./api.js');const original=globalThis.fetch,seen=[]
 globalThis.fetch=async(url,options)=>{seen.push({url,options});return new Response(JSON.stringify({generations:[],keys:[],daily:[]}),{status:200})}
 try{await getDeveloperDashboard({days:7,key_id:'a'.repeat(16)});await getDeveloperGenerations({days:7,state:'FAILED',cursor:'opaque+page',limit:20});assert.ok(seen.every(r=>r.options.credentials==='include'&&!r.options.headers.Authorization));const first=new URL(seen[0].url,'https://test.invalid'),second=new URL(seen[1].url,'https://test.invalid');assert.equal(first.pathname,'/api/account/api-keys/dashboard');assert.equal(first.searchParams.get('days'),'7');assert.equal(second.pathname,'/api/account/api-keys/generations');assert.equal(second.searchParams.get('cursor'),'opaque+page');assert.equal(second.searchParams.get('state'),'FAILED')}finally{globalThis.fetch=original}
})

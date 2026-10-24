import test from 'node:test';
import assert from 'node:assert/strict';
import express,{type ErrorRequestHandler} from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import {ZodError} from 'zod';
import {DeveloperDashboardService} from '../src/services/developer-dashboard.service.js';
import {publicApiKeyManagementRoutes} from '../src/routes/public-api-keys.routes.js';
import {AppError} from '../src/lib/errors.js';
const wallet={plan:{code:'free',name:'Free'},period_end:new Date('2026-11-01'),ai:{remaining:120},classic:{remaining:500},storage:{used_bytes:0,limit_bytes:150000000}};
function setup(){const periods:unknown[]=[];let historyRows:unknown[]=[];
 const model={keyOwned:async(_owner:string,key:string)=>key==='a'.repeat(16),daily:async(_owner:string,p:unknown)=>{periods.push(p);return [{day:'2026-10-19',requests:5,generation_requests:3,jobs:1,failed:1,credits_refunded:50}];},keys:async()=>[],history:async()=>historyRows};
 const service=new DeveloperDashboardService(model as never,{snapshot:async()=>wallet} as never,()=>new Date('2026-10-18T18:00:00Z'));return {service,periods,rows:(rows:unknown[])=>{historyRows=rows;}};
}
test('summary uses Jakarta date boundaries and distinguishes attempts/jobs/refunds',async()=>{
 const ctx=setup(),data=await ctx.service.summary('owner',{days:7,_request:'nonce'});assert.equal(data.daily.length,7);assert.equal(data.daily.at(-1)?.day,'2026-10-19');assert.equal(data.period.from.toISOString(),'2026-10-12T17:00:00.000Z');assert.equal(data.period.to.toISOString(),'2026-10-19T17:00:00.000Z');assert.equal(data.totals.requests,5);assert.equal(data.totals.generation_requests,3);assert.equal(data.totals.jobs,1);assert.equal(data.totals.credits_spent,0);assert.equal(data.totals.credits_refunded,50);assert.equal(data.wallet.ai.remaining,120);
});
test('query rejects unknown account selector, invalid period, status, key and cursor',async()=>{
 const {service}=setup();for(const query of [{account_id:'other'},{days:999},{state:'SUCCESS'},{key_id:'not-a-key'},{limit:1000}])await assert.rejects(service.history('owner',query),ZodError);
 await assert.rejects(service.summary('owner',{key_id:'b'.repeat(16)}),{code:'API_KEY_NOT_FOUND'});
 await assert.rejects(service.history('owner',{cursor:'malformed'}),{code:'CURSOR_INVALID'});
});
test('history is allow-listed, maps paid credits and hides expired/deleted output links',async()=>{
 const ctx=setup(),date=new Date('2026-10-19T01:00:00Z');const row={id:'c'.repeat(32),key_id:'a'.repeat(16),key_name:'Booth',key_prefix:'nxb_live_a',template_id:'template',state:'COMPLETED',created_at:date,finished_at:date,error_code:null,credits:50,charge_status:'CONSUMED',result_id:'d'.repeat(32),expires_at:date,available:false,secret_hash:'hidden',model:'hidden-model'};ctx.rows([row,{...row,id:'e'.repeat(32),available:true}]);
 const first=await ctx.service.history('owner',{limit:1});assert.ok(first.next_cursor);assert.equal(first.generations[0].credit_charge.status,'PAID');assert.equal(first.generations[0].download_url,null);assert.equal(first.generations[0].result_id,null);assert.ok(!JSON.stringify(first).includes('hidden'));
 ctx.rows([{...row,available:true}]);const second=await ctx.service.history('owner',{cursor:first.next_cursor});assert.equal(second.generations[0].download_url,'/api/results/'+'d'.repeat(32)+'/download');
});
test('dashboard/history cookie endpoints reject Bearer-only access and use session owner',async()=>{
 const seen:string[]=[];const dashboard={summary:async(owner:string)=>{seen.push(owner);return {ok:true};},history:async(owner:string)=>{seen.push(owner);return {generations:[]};}};
 const app=express();app.use(cookieParser());app.use('/api/account/api-keys',publicApiKeyManagementRoutes({} as never,{resolve:async (cookies:Record<string,string>)=>({account:cookies.owner?{id:cookies.owner}:null})} as never,dashboard as never));const errors:ErrorRequestHandler=(e,_q,res,_n)=>{res.status(e instanceof AppError?e.status:500).json({code:e.code});};app.use(errors);
 for(const path of ['dashboard','generations']){await request(app).get('/api/account/api-keys/'+path).set('Authorization','Bearer untrusted').expect(401);const res=await request(app).get('/api/account/api-keys/'+path).set('Cookie','owner=account-a').expect(200);assert.match(res.headers['cache-control'],/no-store/);}
 assert.deepEqual(seen,['account-a','account-a']);
});

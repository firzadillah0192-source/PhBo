import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DuitkuSandboxGateway, DUITKU_INVOICE_URL, DUITKU_STATUS_URL, sandboxCheckoutUrl } from '../src/services/duitku-sandbox.service.js';
import { PaymentService } from '../src/services/payment.service.js';
import type { Payment, PaymentStore, PaymentFilter } from '../src/models/payment.model.js';
import { paymentAdminRoutes } from '../src/routes/payment.routes.js';
import type { AdminAuthService } from '../src/services/admin-auth.service.js';
import { AppError } from '../src/lib/errors.js';
import { createMigrationApp } from '../src/migration-app.js';
import type { CustomerAccountService } from '../src/services/customer-account.service.js';
import type { CustomerCatalogService } from '../src/services/customer-catalog.service.js';

const merchantCode = 'DTEST', apiKey = 'synthetic-TEST-key-not-a-real-secret';
const key = 'synthetic-request-key-001', id = 'a'.repeat(32), order = 'nxpay_' + id, reference = 'DTESTREF';
const url = 'https://app-sandbox.duitku.com/redirect_checkout?reference=' + reference;
const sign = (value: string) => createHmac('sha256', apiKey).update(value).digest('hex');
class MemoryPayments implements PaymentStore {
  rows = new Map<string, Payment>(); invoiceClaims = new Set<string>(); checks = new Set<string>(); audits: string[] = [];
  async create(account: string, requestKey: string, credits: number, expiry: Date) {
    const existing = [...this.rows.values()].find(row => row.account_id === account && row.request_key === requestKey);
    if (existing) { if (existing.credits !== credits) throw new AppError(409,'IDEMPOTENCY_CONFLICT','Conflict'); return { ...existing }; }
    const row: Payment = { id, account_id: account, request_key: requestKey, merchant_order_id: order, environment:'sandbox', credits, amount_rupiah: credits*100,
      status:'CREATING', reference:null, checkout_url:null, error_code:null, expires_at:expiry, created_at:new Date(), updated_at:new Date(), paid_at:null,
      sandbox_credited_at:null, callback_received_at:null, last_checked_at:null };
    this.rows.set(id,row); return {...row};
  }
  async find(id: string) { const row=this.rows.get(id); return row?{...row}:null; }
  async byOrder(value: string) { return value===order?this.find(id):null; }
  async claimInvoice(id: string) { if(this.invoiceClaims.has(id))return false;this.invoiceClaims.add(id);return true; }
  async invoice(id: string, ref: string, checkout: string) { const row=this.rows.get(id)!; row.reference=ref;row.checkout_url=checkout;if(row.status==='CREATING')row.status='PENDING';this.invoiceClaims.delete(id); }
  async invoiceError(id: string) { this.invoiceClaims.delete(id);this.rows.get(id)!.error_code='INVOICE_UNCONFIRMED'; }
  async claimVerification(id: string) { if(this.checks.has(id))return false;this.checks.add(id);return true; }
  async verificationError(id: string) { this.rows.get(id)!.error_code='VERIFICATION_UNAVAILABLE'; }
  async settle(id: string, ref: string, status: 'PAID'|'PENDING'|'FAILED', callback:boolean) {
    const row=this.rows.get(id)!;
    row.reference=ref;
    if(row.status!=='PAID')row.status=status;
    if(status==='PAID') { row.paid_at ??=new Date();row.sandbox_credited_at ??=new Date(); }
    row.last_checked_at=new Date();if(callback)row.callback_received_at=new Date();return {...row};
  }
  async list(f: PaymentFilter) { const rows=[...this.rows.values()].filter(row=>!f.account_id||row.account_id===f.account_id);return {transactions:rows,total:rows.length}; }
  async sandboxBalance(account: string) { return [...this.rows.values()].filter(row=>row.account_id===account&&row.status==='PAID').reduce((sum,row)=>sum+row.credits,0); }
  async auditCheck(_id:string,actor:string) { this.audits.push(actor); }
}
function fixture() {
  const store=new MemoryPayments();let invoiceCalls=0,statusCalls=0,code='00',amount='10000',ref=reference,failing=false;
  const calls:{url:string;body:any;headers:Headers}[]=[];
  const transport:typeof fetch=async(input,init)=>{
    calls.push({url:String(input),body:JSON.parse(String(init?.body)),headers:new Headers(init?.headers)});
    if(failing)throw new Error('sensitive upstream detail must be redacted');
    if(String(input)===DUITKU_INVOICE_URL) { invoiceCalls++;return Response.json({merchantCode,reference,paymentUrl:url,statusCode:'00'}); }
    statusCalls++;return Response.json({merchantOrderId:order,reference:ref,amount,statusCode:code});
  };
  const gateway=new DuitkuSandboxGateway({merchantCode,apiKey},transport),service=new PaymentService(store,gateway,{enabled:true,publicOrigin:'https://nxbooth.example'});
  const callback=()=>({merchantCode,merchantOrderId:order,reference,amount:'10000',resultCode:'00',signature:sign(merchantCode+'10000'+order)});
  return {store,service,gateway,calls,callback,get invoiceCalls(){return invoiceCalls},get statusCalls(){return statusCalls},setCode:(v:string)=>code=v,setAmount:(v:string)=>amount=v,setReference:(v:string)=>ref=v,fail:()=>failing=true};
}
const account={id:'test-account',email:'synthetic@example.invalid'};
function app(service: PaymentService, signedIn=true) {
  const accounts={config:{cookieSecure:false},payments:service,resolve:async()=>({account:signedIn?account:null}),requireAccount:(identity:any)=>{if(!identity.account)throw new AppError(401,'AUTHENTICATION_REQUIRED','Sign in');return identity.account;}} as unknown as CustomerAccountService;
  return createMigrationApp({} as CustomerCatalogService,{corsOrigins:['https://nxbooth.example']},accounts);
}
test('invoice uses fixed sandbox endpoint, HMAC headers, trusted amounts and idempotent checkout',async()=>{
  const f=fixture();const first=await f.service.checkout(account,100,key),second=await f.service.checkout(account,100,key);
  assert.equal(first.checkout_url,url);assert.equal(second.id,first.id);assert.equal(f.invoiceCalls,1);assert.equal(first.status,'PENDING');
  const call=f.calls[0];assert.equal(call.body.paymentAmount,10000);assert.equal(call.body.itemDetails[0].price,10000);assert.equal(call.body.callbackUrl,'https://nxbooth.example/api/payments/duitku/callback');
  assert.equal(call.headers.get('x-duitku-signature'),sign(merchantCode+call.headers.get('x-duitku-timestamp')));
  await assert.rejects(f.service.checkout(account,200,key),{code:'IDEMPOTENCY_CONFLICT'});
  assert.equal(await f.store.sandboxBalance(account.id),0);
});
test('callback verifies HMAC then authenticates status; repeated success credits sandbox exactly once',async()=>{
  const f=fixture();await f.service.checkout(account,100,key);await f.service.callback(f.callback());await f.service.callback(f.callback());
  assert.equal(f.statusCalls,1);assert.equal(await f.store.sandboxBalance(account.id),100);
  assert.equal((await f.store.find(id))!.status,'PAID');assert.ok((await f.store.find(id))!.sandbox_credited_at);
  const call=f.calls.find(c=>c.url===DUITKU_STATUS_URL)!;assert.equal(call.body.signature,sign(merchantCode+order));
});
test('forged resultCode on valid signed pending callback cannot mark order paid',async()=>{
  const f=fixture();f.setCode('01');await f.service.checkout(account,100,key);await f.service.callback(f.callback());
  assert.equal((await f.store.find(id))!.status,'PENDING');assert.equal(await f.store.sandboxBalance(account.id),0);
});
test('failure response grants zero sandbox credits',async()=>{
  const f=fixture();f.setCode('02');await f.service.checkout(account,100,key);await f.service.callback({...f.callback(),resultCode:'01'});
  assert.equal((await f.store.find(id))!.status,'FAILED');assert.equal(await f.store.sandboxBalance(account.id),0);
});
test('bad signature, wrong merchant, wrong amount and wrong reference are rejected',async()=>{
  const f=fixture();await f.service.checkout(account,100,key);
  for(const patch of [{signature:'0'.repeat(64)},{merchantCode:'OTHER'}])await assert.rejects(f.service.callback({...f.callback(),...patch}),{code:'PAYMENT_SIGNATURE_INVALID'});
  await assert.rejects(f.service.callback({...f.callback(),amount:'20000',signature:sign(merchantCode+'20000'+order)}),{code:'PAYMENT_AMOUNT_MISMATCH'});
  await assert.rejects(f.service.callback({...f.callback(),reference:'OTHER'}),{code:'PAYMENT_REFERENCE_MISMATCH'});
  assert.equal(f.statusCalls,0);
});
test('provider amount and reference mismatches preserve pending status and zero balance',async()=>{
  for(const field of ['amount','reference']){
    const f=fixture();await f.service.checkout(account,100,key);if(field==='amount')f.setAmount('20000');else f.setReference('OTHER');
    await assert.rejects(f.service.callback(f.callback()),{code:'PAYMENT_VERIFICATION_MISMATCH'});
    assert.equal((await f.store.find(id))!.status,'PENDING');assert.equal(await f.store.sandboxBalance(account.id),0);
  }
});
test('provider outage keeps order recoverable and redacts upstream details',async()=>{
  const f=fixture();f.fail();await assert.rejects(f.service.checkout(account,100,key),(e:unknown)=>e instanceof AppError&&!e.message.includes('sensitive'));
  assert.equal((await f.store.find(id))!.status,'CREATING');assert.equal((await f.store.find(id))!.error_code,'INVOICE_UNCONFIRMED');
});
test('only exact HTTPS sandbox checkout links are accepted',()=>{
  for(const value of ['javascript:alert(1)','https://evil.example/redirect_checkout','https://app-sandbox.duitku.com.evil.example/redirect_checkout','https://user:pass@app-sandbox.duitku.com/redirect_checkout','https://app-sandbox.duitku.com/other','http://app-sandbox.duitku.com/redirect_checkout'])assert.throws(()=>sandboxCheckoutUrl(value));
  assert.equal(sandboxCheckoutUrl(url),url);
});
test('HTTP checkout authenticates, validates amount, blocks cross origin and isolates ownership',async()=>{
  const f=fixture();assert.equal((await request(app(f.service,false)).post('/api/account/topups/checkout').send({credits:100})).status,401);
  for(const credits of [0,1.2,100001,'100'])assert.equal((await request(app(f.service)).post('/api/account/topups/checkout').send({credits})).status,422);
  assert.equal((await request(app(f.service)).post('/api/account/topups/checkout').set('Origin','https://evil.example').send({credits:100})).status,403);
  const res=await request(app(f.service)).post('/api/account/topups/checkout').set('Idempotency-Key',key).send({credits:100});assert.equal(res.status,200);assert.equal(res.body.amount_rupiah,10000);
  await assert.rejects(f.service.detail(id,'different-account'),{code:'PAYMENT_NOT_FOUND'});
  await assert.rejects(f.service.refresh(id,'different-account'),{code:'PAYMENT_NOT_FOUND'});
  const history=await request(app(f.service)).get('/api/account/topups');assert.equal(history.status,200);assert.equal(history.body.transactions.length,1);assert.equal(history.body.transactions[0].request_key,undefined);assert.equal(history.body.transactions[0].user_email,undefined);
});
test('real Express accepts form-urlencoded callbacks and ignores spoofed return status on reads',async()=>{
  const f=fixture();await f.service.checkout(account,100,key);
  const res=await request(app(f.service)).post('/api/payments/duitku/callback').type('form').send(f.callback());assert.equal(res.status,200);assert.equal(res.text,'OK');
  const detail=await request(app(f.service)).get('/api/account/topups/'+id+'?resultCode=00');assert.equal(detail.body.status,'PAID');
  const pending=fixture();await pending.service.checkout(account,100,key);const read=await request(app(pending.service)).get('/api/account/topups/'+id+'?resultCode=00');assert.equal(read.body.status,'PENDING');assert.equal(pending.statusCalls,0);
});
test('admin transaction endpoints allow operator and superadmin, reject customer/content manager, audit rechecks',async()=>{
  const f=fixture();await f.service.checkout(account,100,key);
  for(const role of ['operator','superadmin','content_manager','customer']){
    const auth={resolve:async()=>{if(role==='customer')throw new AppError(401,'AUTHENTICATION_REQUIRED','Sign in');return {actor_id:'actor',role};},requireRole:(actor:any,required:string)=>{if(actor.role!=='superadmin'&&actor.role!==required)throw new AppError(403,'ADMIN_FORBIDDEN','Forbidden');}} as unknown as AdminAuthService;
    const a=express();a.use(cookieParser());a.use('/payments',paymentAdminRoutes(auth,f.service));a.use(((e:any,_req:any,res:any,_next:any)=>res.status(e.status||500).json({code:e.code})) as express.ErrorRequestHandler);
    assert.equal((await request(a).get('/payments')).status,role==='customer'?401:role==='content_manager'?403:200);
    if(role==='operator'){const res=await request(a).post('/payments/'+id+'/refresh');assert.equal(res.status,200);assert.deepEqual(f.store.audits,['actor']);}
  }
});
test('disabled integration performs no transaction writes',async()=>{
  const f=fixture();const service=new PaymentService(f.store,f.gateway,{enabled:false,publicOrigin:'https://nxbooth.example'});
  await assert.rejects(service.checkout(account,100,key),{code:'PAYMENT_GATEWAY_UNAVAILABLE'});assert.equal(f.store.rows.size,0);
  assert.deepEqual(Object.keys(service.settings()).sort(),['credit_rupiah','enabled','environment','max_credits','message']);
});

test('POP status uses the official PHP library endpoint with current HMAC authentication', async () => {
  assert.equal(DUITKU_STATUS_URL, 'https://api-sandbox.duitku.com/api/merchant/transactionStatus');
  for (const [code,body] of [[400,'Transaction not found'],[404,JSON.stringify({Message:'Transaction not found'})]] as const) {
    const gateway=new DuitkuSandboxGateway({merchantCode,apiKey},async()=>new Response(body,{status:code}));
    assert.deepEqual(await gateway.status(order),{notStarted:true});
  }
});
test('other provider errors and malformed replies never become not-started or paid', async () => {
  for (const [code,body] of [[400,'Invalid signature'],[403,'Transaction not found'],[200,'not JSON']] as const) {
    const gateway=new DuitkuSandboxGateway({merchantCode,apiKey},async()=>new Response(body,{status:code}));
    await assert.rejects(gateway.status(order));
  }
});
test('not-started invoice status remains pending and never grants sandbox credits',async()=>{
  const f=fixture();await f.service.checkout(account,100,key);
  const gateway=new DuitkuSandboxGateway({merchantCode,apiKey},async()=>new Response('Transaction not found',{status:400}));
  const service=new PaymentService(f.store,gateway,{enabled:true,publicOrigin:'https://nxbooth.example'});
  const result=await service.refresh(id,account.id);
  assert.equal(result.status,'PENDING');assert.equal(await f.store.sandboxBalance(account.id),0);
});

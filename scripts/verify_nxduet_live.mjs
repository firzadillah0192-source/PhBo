// Explicit deployment acceptance only. Creates its own synthetic account, grants
// 100 non-purchased test credits through the wallet, calls the real provider once,
// verifies the web-port flow, deletes its template, then suspends its account.
// No existing customer account, photo, payment or invoice is modified.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomBytes,randomUUID } from 'node:crypto'
import { readFile,writeFile } from 'node:fs/promises'
import sharp from '../backend-express/node_modules/sharp/lib/index.js'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { validateOverlay } from '../backend-express/dist/nxduet/policy.js'
if(!process.argv.includes('--approved-live-acceptance'))throw new Error('Explicit live acceptance flag required; owner deploy approval is also required')
const exec=promisify(execFile),release=(await readFile('/srv/photobooth/releases/.nxduet-current','utf8')).trim()
assert.ok(release.startsWith('/srv/photobooth/releases/nxduet-'))
const manifest=JSON.parse(await readFile(release+'/manifest.json','utf8'));assert.equal(manifest.deployed,true)
const base='http://127.0.0.1:3000',cookies=new Map(),email=`nxduet-deploy-${randomUUID()}@example.invalid`,password=randomBytes(32).toString('hex')
let accountId=null,templateId=null,granted=false
const verification={status:'RUNNING',coverage:'real web-port account/upload/worker/provider/wallet/private-storage/compose flow with synthetic graphic; not a human portrait or physical camera'}
async function http(path,options={},anonymous=false){
  const response=await fetch(base+path,{...options,headers:{...(anonymous?{}:{Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; ')}),...options.headers}})
  if(!anonymous)for(const value of response.headers.getSetCookie()){const pair=value.split(';',1)[0],i=pair.indexOf('=');cookies.set(pair.slice(0,i),pair.slice(i+1))}
  if(!response.ok){let code='HTTP_'+response.status;try{code=(await response.json()).detail?.error_code||code}catch{}throw new Error(code)}
  return response
}
async function json(path,options={}){return (await http(path,options)).json()}
const post=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
async function internal(code){const result=await exec('docker',['exec','photobooth-express','node','--input-type=module','-e',`import { PrismaClient } from '@prisma/client';import { PrismaPg } from '@prisma/adapter-pg';import { SubscriptionWalletModel } from './dist/models/subscription-wallet.model.js';const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});try{const row=await db.nxAccount.findUnique({where:{id:${JSON.stringify(accountId)}}});if(!row||row.email!==${JSON.stringify(email)})throw new Error('Synthetic account mismatch');${code}}finally{await db.$disconnect()}`],{maxBuffer:1024*1024});return result.stdout?JSON.parse(result.stdout):null}
try{
  assert.deepEqual(await json('/api/nxduet/capabilities'),{enabled:true,preparation_credits:100})
  await json('/api/account/signup',post({email,password}));accountId=(await json('/api/account/me')).id;assert.match(accountId,/^[a-f0-9]{32}$/)
  assert.equal((await json('/api/account/usage')).subscription.ai.remaining,0)
  await internal(`const wallets=new SubscriptionWalletModel(db,undefined,true);await db.$transaction(tx=>wallets.adjustIn(tx,row.id,'AI',100,${JSON.stringify('nxduet:acceptance:grant:'+manifest.release.split('/').at(-1))},'NXDuet deployment acceptance: non-purchased synthetic test allocation'));`);granted=true
  const source=await sharp(Buffer.from('<svg width="768" height="768"><rect width="768" height="768" fill="#4695b8"/><circle cx="384" cy="245" r="115" fill="#e8b58d"/><path d="M260 240Q230 70 384 70Q530 90 510 240L480 140L280 160Z" fill="#2d2530"/><rect x="200" y="360" width="368" height="408" rx="105" fill="#ef9834"/><circle cx="350" cy="245" r="10" fill="#28232a"/><circle cx="419" cy="245" r="10" fill="#28232a"/><path d="M350 290Q384 320 420 290" fill="none" stroke="#8b4549" stroke-width="8"/></svg>')).jpeg().toBuffer()
  const upload=new FormData();upload.append('file',new Blob([source],{type:'image/jpeg'}),'synthetic-companion.jpg')
  const input=await json('/api/uploads',{method:'POST',body:upload});verification.upload_id=input.upload_id
  const body={upload_id:input.upload_id,name:'NXDuet deployment acceptance (synthetic)',rights_accepted:true},key=randomUUID(),options={...post(body),headers:{'Content-Type':'application/json','Idempotency-Key':key}}
  const created=await json('/api/nxduet/templates',options);templateId=created.id;verification.template_id=templateId
  const replay=await json('/api/nxduet/templates',options);assert.equal(replay.id,templateId)
  const deadline=Date.now()+600000;let current,lastState
  while(Date.now()<deadline){
    current=await json('/api/nxduet/templates/'+templateId)
    if(current.state!==lastState){console.log(JSON.stringify({acceptance_state:current.state}));lastState=current.state}
    if(['COMPLETED','FAILED'].includes(current.state))break
    await delay(2000)
  }
  assert.equal(current.state,'COMPLETED','Real preparation did not complete: '+(current.error_code||current.state));assert.equal(current.charge_status,'CONSUMED');assert.equal(current.credits,100)
  assert.equal((await json('/api/account/usage')).subscription.ai.remaining,0)
  const held=await internal(`const rows=await db.$queryRaw\`SELECT count(*)::int AS n FROM subscription_v2_ledger WHERE owner_scope=\${'account:'+row.id} AND idempotency_key=\${'v2:hold:nxduet:'+${JSON.stringify(templateId)}}\`;process.stdout.write(JSON.stringify(rows[0]));`);assert.equal(held.n,1)
  assert.ok((await json('/api/nxduet/templates')).templates.some(item=>item.id===templateId))
  const bytes=Buffer.from(await (await http(`/api/nxduet/templates/${templateId}/image`)).arrayBuffer());verification.overlay=await validateOverlay(bytes)
  assert.equal((await fetch(base+`/api/nxduet/templates/${templateId}/image`)).status,401)
  const form=new FormData();form.append('placement',JSON.stringify({side:'right',scale:.9}))
  for(let i=0;i<3;i++)form.append('captures',new Blob([source],{type:'image/jpeg'}),`synthetic-${i}.jpg`)
  const strip=Buffer.from(await (await http(`/api/nxduet/templates/${templateId}/compose`,{method:'POST',body:form})).arrayBuffer()),metadata=await sharp(strip).metadata();assert.equal(metadata.width,1300);assert.equal(metadata.height,3000)
  assert.equal((await json('/api/account/usage')).subscription.ai.remaining,0)
  await http('/api/nxduet/templates/'+templateId,{method:'DELETE'})
  for(let attempt=0;attempt<20;attempt++){const row=await internal(`const rows=await db.$queryRaw\`SELECT source_path,overlay_path FROM nxduet_templates WHERE id=\${${JSON.stringify(templateId)}}\`;process.stdout.write(JSON.stringify(rows[0]));`);if(row.source_path===''&&row.overlay_path===null){verification.asset_cleanup=true;break}await delay(500)}
  assert.equal(verification.asset_cleanup,true)
  verification.status='PASS';verification.preparation_credits=100;verification.replay_same_template=true;verification.private_image_check=true;verification.strip={width:metadata.width,height:metadata.height};verification.reuse_additional_credits=0
}catch(error){verification.status='FAIL';verification.error=/^[A-Z_0-9]+$/.test(error.message)?error.message:'LIVE_ACCEPTANCE_ASSERTION_FAILED';process.exitCode=1}
finally{
  if(accountId){try{await internal(`await db.nxAuthSession.deleteMany({where:{account_id:row.id}});await db.nxAccount.update({where:{id:row.id},data:{status:'suspended',display_name:'NXDuet deployment acceptance (synthetic)'}});`);verification.synthetic_account_suspended=true}catch{verification.synthetic_account_cleanup='FAILED';verification.status='FAIL';process.exitCode=1}}
  verification.non_purchased_test_allocation=granted?100:0
  await writeFile(release+'/acceptance.json',JSON.stringify(verification,null,2)+'\n',{mode:0o600})
  console.log(JSON.stringify(verification))
}

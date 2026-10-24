// One live provider request using a synthetic graphic. No customer photos, wallet
// writes, deployments or migrations. Credentials stay inside the running API.
import { spawn } from 'node:child_process'
import { mkdir,writeFile } from 'node:fs/promises'
import { validateOverlay,PREPARATION_PROMPT } from '../backend-express/dist/nxduet/policy.js'

const source=`
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { NativeNineRouterProvider } from './dist/services/native-provider.service.js';
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
try{
  if(process.env.AI_PROVIDER!=='9router')throw new Error('PROVIDER_NOT_CONNECTED');
  const experience=await db.nxExperience.findUnique({where:{id:process.env.BASIC_MODEL_EXPERIENCE_ID||'mini-me'},select:{model:true}});
  const model=process.env.NXDUET_MODEL||experience?.model;if(!model)throw new Error('MODEL_NOT_CONFIGURED');
  const input=await sharp(Buffer.from('<svg width="768" height="768"><rect width="768" height="768" fill="#4695b8"/><circle cx="384" cy="245" r="115" fill="#e8b58d"/><path d="M260 240Q230 70 384 70Q530 90 510 240L480 140L280 160Z" fill="#2d2530"/><rect x="200" y="360" width="368" height="408" rx="105" fill="#ef9834"/><circle cx="350" cy="245" r="10" fill="#28232a"/><circle cx="419" cy="245" r="10" fill="#28232a"/><path d="M350 290Q384 320 420 290" fill="none" stroke="#8b4549" stroke-width="8"/></svg>')).jpeg().toBuffer();
  // Inject the same NXDuet-only request options as the new adapter, without
  // changing the live application code or its normal generation behavior.
  const provider=new NativeNineRouterProvider({baseUrl:process.env.NINEROUTER_BASE_URL||'',key:process.env.NINEROUTER_API_KEY||'',timeoutMs:Number(process.env.NINEROUTER_TIMEOUT_SECONDS||300)*1000,resultOrigins:(process.env.PROVIDER_RESULT_ORIGINS||'').split(',').map(v=>v.trim()).filter(Boolean)},(url,init)=>{if(init?.method!=='POST'||!init.body)return fetch(url,init);const body=JSON.parse(init.body);return fetch(url,{...init,body:JSON.stringify({...body,background:'transparent',output_format:'png'})});});
  const output=await provider.generate(input,${JSON.stringify(PREPARATION_PROMPT)},model);
  process.stdout.write(JSON.stringify({ok:true,bytes:output.bytes.toString('base64')}));
}catch(error){process.stdout.write(JSON.stringify({ok:false,code:/^[A-Z_]{1,64}$/.test(error.code||error.message)?error.code||error.message:'PROVIDER_TEST_FAILED',http_status:error.meta?.http_status??null}));process.exitCode=1;}
finally{await db.$disconnect();}
`
const child=spawn('docker',['exec','-i','photobooth-express','node','--input-type=module'],{stdio:['pipe','pipe','pipe']})
let stdout='',stderr='';child.stdout.on('data',data=>{stdout+=data;if(stdout.length>40*1024*1024)child.kill()});child.stderr.on('data',data=>{stderr+=data;if(stderr.length>8192)stderr=stderr.slice(-8192)})
child.stdin.end(source)
const code=await new Promise(resolve=>child.on('close',resolve))
let result;try{result=JSON.parse(stdout)}catch{console.log(JSON.stringify({status:'FAIL',code:'PROVIDER_TEST_RUNTIME_FAILED',exit_code:code}));process.exit(1)}
if(!result.ok){console.log(JSON.stringify({status:'FAIL',code:result.code,http_status:result.http_status}));process.exit(1)}
const bytes=Buffer.from(result.bytes,'base64')
await mkdir('/tmp/nxduet-provider-check',{recursive:true});await writeFile('/tmp/nxduet-provider-check/synthetic-cutout.png',bytes,{mode:0o600})
try{const info=await validateOverlay(bytes);console.log(JSON.stringify({status:'PASS',...info,size_bytes:bytes.length,artifact:'/tmp/nxduet-provider-check/synthetic-cutout.png',coverage:'one real configured-provider cutout of synthetic graphic; no human identity acceptance'}))}catch(error){console.log(JSON.stringify({status:'FAIL',code:error.code,artifact:'/tmp/nxduet-provider-check/synthetic-cutout.png'}));process.exitCode=1}

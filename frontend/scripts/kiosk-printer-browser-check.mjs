import assert from 'node:assert/strict'
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createServer} from 'vite'
import {chromium} from '/srv/photobooth/tmp/frame-preview-browser/node_modules/playwright-core/index.mjs'
import {Journal} from '../../desktop/shared/journal.mjs'
import {Bridge} from '../../desktop/shared/bridge.mjs'
import {PrinterService,startPrinterServer} from '../../desktop/shared/printer-service.mjs'
const output='/srv/photobooth/tmp/kiosk-printer-browser';await mkdir(output,{recursive:true})
const root=await mkdtemp('/srv/photobooth/tmp/printer-browser-'),assets=join(root,'assets');await mkdir(assets)
const journal=await Journal.open(join(root,'journal.sqlite'))
const bridge=new Bridge(process.env.PHBO_DOTNET||'dotnet',[resolve('../desktop/native/KioskBridge/bin/Release/net10.0/KioskBridge.dll'),'--root',assets,'--simulated'])
const service=new PrinterService({bridge,journal,assets})
const source=`import React from'react';import{createRoot}from'react-dom/client';import KioskPreview from'/src/components/kiosk/KioskPreview.jsx';import'/src/styles.css';createRoot(document.getElementById('root')).render(<KioskPreview/>);`
const vite=await createServer({root:process.cwd(),logLevel:'silent',server:{host:'127.0.0.1',port:0},plugins:[{name:'print-check',resolveId(id){if(id==='/print-check.jsx')return id},load(id){if(id==='/print-check.jsx')return source},configureServer(server){server.middlewares.use(async(req,res,next)=>{if(req.url==='/print-check'){res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/print-check.jsx"></script></body></html>'))}else next()})}}]});await vite.listen()
const base=`http://127.0.0.1:${vite.httpServer.address().port}`
const local=await startPrinterServer(service,{port:0,origin:base})
const image=await readFile('/srv/photobooth/releases/classic-single-window-20261010T120247Z/live-synthetic-result.png')
const browser=await chromium.launch({executablePath:'/home/mahez/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',args:['--no-sandbox']})
const checks=[]
try{
 for(const width of [1440,390,320]){
  const id='fixture-'+width,context=await browser.newContext({viewport:{width,height:1000}});let posts=0,loseResponse=width===390
  await context.addInitScript(()=>sessionStorage.setItem('nxbooth:kiosk-web-job',JSON.stringify({jobId:'fixture-job',mode:'CLASSIC'})))
  await context.route('http://127.0.0.1:20253/**',async route=>{
   const req=route.request(),url=new URL(req.url());const method=req.method();if(method==='POST')posts++
   const response=await fetch(`http://127.0.0.1:${local.port}`+url.pathname,{method,headers:{Origin:base,Authorization:req.headers().authorization||'',...method==='POST'?{'Content-Type':'application/json'}:{}},body:method==='POST'?req.postData():undefined})
   const body=await response.text()
   if(method==='POST'&&loseResponse){loseResponse=false;await route.abort();return}
   await route.fulfill({status:response.status,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':base,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, POST'},body})
  })
  await context.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;let body={}
   if(path.endsWith('/generations/fixture-job'))body={job_id:'fixture-job',state:'COMPLETED',result_id:id}
   else if(path.endsWith('/image')){await route.fulfill({contentType:'image/png',body:image});return}
   else if(path.endsWith('/claim'))body={claim_url:'https://nxbooth.gennexbyte.com/r/'+'a'.repeat(43),qr_payload:'https://nxbooth.gennexbyte.com/r/'+'a'.repeat(43),expires_at:'2026-12-01T00:00:00Z'}
   else if(path.endsWith('/results/'+id))body={result_id:id}
   else if(path.endsWith('/classic/layouts')||path.endsWith('/advanced/frame-styles'))body=[]
   else if(path.endsWith('/templates'))body={templates:[]}
   else if(path.endsWith('/experiences'))body={experiences:[]}
   else if(path.endsWith('/account/usage'))body={ai_remaining:50}
   await route.fulfill({contentType:'application/json',body:JSON.stringify(body)})
  })
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto(base+'/print-check');await page.getByRole('button',{name:'Cetak foto →'}).waitFor();assert.ok(await page.getByRole('button',{name:'Cetak foto →'}).isDisabled())
  await page.getByRole('button',{name:'Operator',exact:true}).click();await page.getByLabel('Kode koneksi printer',{exact:true}).fill(local.token);await page.getByRole('button',{name:'Hubungkan printer',exact:true}).click()
  await page.getByRole('button',{name:'Simulasi cetak',exact:true}).waitFor();assert.equal(await page.getByLabel('Kode koneksi printer',{exact:true}).inputValue(),'')
  await page.getByRole('button',{name:'Tutup panel operator',exact:true}).click();await page.getByRole('button',{name:'Simulasi cetak',exact:true}).click()
  await page.getByText('Simulasi cetak selesai; tidak ada kertas dicetak.',{exact:true}).waitFor();assert.ok(await page.getByRole('button',{name:'Simulasi cetak',exact:true}).isDisabled());assert.equal(posts,1)
  assert.equal(service.job(id).status,'SIMULATED');assert.deepEqual(errors,[])
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
  await page.screenshot({path:output+'/print-'+width+'.png',fullPage:true});
  await page.reload();await page.getByRole('button',{name:'Cetak foto →'}).waitFor();await page.getByRole('button',{name:'Operator',exact:true}).click();await page.getByLabel('Kode koneksi printer',{exact:true}).fill(local.token);await page.getByRole('button',{name:'Hubungkan printer',exact:true}).click();await page.getByText('Simulasi cetak selesai; tidak ada kertas dicetak.',{exact:true}).waitFor();assert.equal(posts,1)
  checks.push({width,pairing:true,realDotnetSimulatedPrint:true,noDuplicateAfterReload:true,lossReconciled:width===390,noOverflow:true});await context.close()
 }
 const report={status:'PASS',checks,backend:'HTTP fixtures',physicalPrinter:false,productionWrites:0};await writeFile(output+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}finally{await browser.close();await local.close();bridge.close();journal.close();await vite.close();await rm(root,{recursive:true,force:true})}

import assert from 'node:assert/strict'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {createServer} from 'vite'
import {chromium} from '/srv/photobooth/tmp/frame-preview-browser/node_modules/playwright-core/index.mjs'
const output='/srv/photobooth/tmp/preview-recovery-browser';await mkdir(output,{recursive:true})
const source=`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{CatalogImage}from'/src/components/home/ModeCards.jsx';function App(){const[src,setSrc]=useState('/first.png'),[show,setShow]=useState(true);return <main>{show&&<CatalogImage src={src} alt="Frame preview" loading="eager" fallback="Preview belum tersedia"/>}<button onClick={()=>setSrc('/second.png')}>Change source</button><button onClick={()=>setShow(false)}>Unmount</button></main>}createRoot(document.getElementById('root')).render(<App/>);`
const server=await createServer({root:process.env.PREVIEW_RECOVERY_SOURCE||process.cwd(),logLevel:'silent',server:{host:'127.0.0.1',port:5196,strictPort:true},plugins:[{name:'preview-recovery',resolveId(id){if(id==='/check.jsx')return id},load(id){if(id==='/check.jsx')return source},configureServer(s){s.middlewares.use(async(req,res,next)=>{if(req.url==='/check'){res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(req.url,'<html><body><div id="root"></div><script type="module" src="/check.jsx"></script></body></html>'))}else next()})}}]});await server.listen()
const bytes=await readFile('../backend/app/data/classic-personalized-v3/classic-frame-001/preview.png')
const browser=await chromium.launch({executablePath:'/home/mahez/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',args:['--no-sandbox']})
try{
 for(const scenario of ['transient','permanent','unmount']){
  const page=await browser.newPage();let attempts=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/first.png',async route=>{attempts++;if(scenario==='transient'&&attempts===2)await route.fulfill({contentType:'image/png',body:bytes,headers:{'Cache-Control':'no-store'}});else await route.abort()})
  await page.route('**/second.png',route=>route.fulfill({contentType:'image/png',body:bytes}))
  await page.goto('http://127.0.0.1:5196/check');await page.getByText('Preview belum tersedia',{exact:true}).waitFor()
  if(scenario==='unmount'){await page.getByRole('button',{name:'Unmount',exact:true}).click();await page.waitForTimeout(1600);assert.equal(attempts,1)}
  else if(scenario==='transient'){await page.waitForFunction(()=>document.querySelector('img')?.naturalWidth===1200);assert.equal(attempts,2);assert.equal(await page.getByText('Preview belum tersedia',{exact:true}).count(),0)}
  else{await page.waitForTimeout(1800);assert.equal(attempts,2);await page.getByText('Preview belum tersedia',{exact:true}).waitFor();await page.getByRole('button',{name:'Change source',exact:true}).click();await page.waitForFunction(()=>document.querySelector('img')?.naturalWidth===1200);assert.equal(await page.getByText('Preview belum tersedia',{exact:true}).count(),0)}
  assert.deepEqual(errors,[]);await page.close();console.log('PASS',scenario)
 }
 await writeFile(output+'/report.json',JSON.stringify({status:'PASS',transientRetry:true,permanentFailureBounded:true,sourceChangeRecovers:true,unmountCancelsRetry:true},null,2))
}finally{await browser.close();await server.close()}

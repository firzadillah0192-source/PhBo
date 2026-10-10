import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'vite'
import { chromium } from '/srv/photobooth/tmp/frame-preview-browser/node_modules/playwright-core/index.mjs'

const output='/srv/photobooth/tmp/frame-preview-browser/checks'
await mkdir(output,{recursive:true})
const source=`import React,{useState}from'react';import{createRoot}from'react-dom/client';import ModePickerModal from'/src/components/customer/ModePickerModal.jsx';import ClassicCaptureStage from'/src/components/customer/ClassicCaptureStage.jsx';import'/src/styles.css';import'/src/customer.css';import'/src/retro.css';
const layout={id:'classic-floral-event-001',name:'Blue Floral · Nama Event',shot_count:3,requires_event_name:true,preview_url:'/fixture-frame.png'};function Harness(){const[selected,setSelected]=useState(false);return <main className="customer-app retro-app">{selected?<ClassicCaptureStage layout={layout} onBack={()=>setSelected(false)} onComplete={()=>{}}/>:<ModePickerModal mode="CLASSIC" templates={[]} experiences={[]} layouts={[layout]} onSelect={()=>setSelected(true)} onBack={()=>{}} onClose={()=>{}}/>}</main>}createRoot(document.getElementById('root')).render(<Harness/>);`
const preview=await readFile('/opt/photobooth/backend/app/data/classic-floral-event-001/preview.png')
const vite=await createServer({root:process.env.FRAME_PREVIEW_SOURCE||'/opt/photobooth/frontend',logLevel:'silent',server:{host:'127.0.0.1',port:5195,strictPort:true},plugins:[{name:'frame-preview-check',resolveId(id){if(id==='/frame-preview-check.jsx')return id},load(id){if(id==='/frame-preview-check.jsx')return source},configureServer(server){server.middlewares.use(async(req,res,next)=>{if(req.url==='/fixture-frame.png'){res.setHeader('Content-Type','image/png');res.end(preview)}else if(req.url==='/frame-preview-check'){res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/frame-preview-check.jsx"></script></body></html>'))}else next()})}}]})
await vite.listen()
const browser=await chromium.launch({executablePath:'/home/mahez/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',args:['--no-sandbox']})
const checks=[]
try{
  for(const width of [1440,390,320]){
    const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'})
    const errors=[];page.on('pageerror',error=>errors.push(error.message))
    await page.goto('http://127.0.0.1:5195/frame-preview-check')
    const card=page.getByRole('button',{name:/Blue Floral/});await card.waitFor()
    await page.waitForFunction(()=>document.querySelector('.studio-picker-image img')?.naturalHeight===3600)
    const geometry=await card.locator('img').evaluate(img=>{const box=img.getBoundingClientRect(),parent=img.parentElement.getBoundingClientRect();return {imageHeight:box.height,imageWidth:box.width,parentHeight:parent.height,parentWidth:parent.width,fit:getComputedStyle(img).objectFit}})
    assert.equal(geometry.fit,'contain');assert.ok(Math.abs(geometry.imageHeight-geometry.parentHeight)<1);assert.ok(Math.abs(geometry.imageWidth-geometry.parentWidth)<1)
    await page.screenshot({path:output+'/picker-'+width+'.png'})
    await card.click();const selected=page.getByAltText('Preview frame Blue Floral · Nama Event');await selected.waitFor()
    await page.waitForFunction(()=>document.querySelector('.classic-selected-frame img')?.naturalHeight===3600)
    assert.equal(await selected.evaluate(img=>getComputedStyle(img).objectFit),'contain')
    assert.equal(await selected.evaluate(img=>img.getBoundingClientRect().height),360)
    assert.equal(await page.getByRole('button',{name:'Choose 3 photos'}).isDisabled(),true)
    await page.getByLabel('Nama event',{exact:true}).fill('Uji Preview')
    assert.equal(await page.getByRole('button',{name:'Choose 3 photos'}).isDisabled(),false)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    await selected.scrollIntoViewIfNeeded();await page.screenshot({path:output+'/selected-'+width+'.png'})
    await page.getByRole('button',{name:'Change frame'}).click();await card.waitFor();assert.deepEqual(errors,[])
    checks.push({width,wholeStripInPicker:true,selectedPreview:true,requiredName:true,changeFrame:true,noOverflow:true});await page.close()
  }
  const page=await browser.newPage();await page.route('**/fixture-frame.png',route=>route.abort());await page.goto('http://127.0.0.1:5195/frame-preview-check')
  await page.getByText('Preview belum tersedia',{exact:true}).waitFor();await page.getByRole('button',{name:/Blue Floral/}).click();await page.getByText('Preview frame belum tersedia',{exact:true}).waitFor();await page.close()
  const result={status:'PASS',checks,failedImageFallback:true,productionWrites:0};await writeFile(output+'/report.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result))
}finally{await browser.close();await vite.close()}

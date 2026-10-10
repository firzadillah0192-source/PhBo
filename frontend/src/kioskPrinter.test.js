import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {pairPrinter,getPrinterStatus,getPrintJob,disconnectPrinter,submitPrint} from './kioskPrinter.js'
const originalFetch=globalThis.fetch,originalWindow=globalThis.window,originalLocation=globalThis.location,originalReader=globalThis.FileReader
afterEach(()=>{disconnectPrinter();globalThis.fetch=originalFetch;globalThis.window=originalWindow;globalThis.location=originalLocation;globalThis.FileReader=originalReader})
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')
function reader(){globalThis.FileReader=class{async readAsDataURL(blob){this.result='data:image/png;base64,'+Buffer.from(await blob.arrayBuffer()).toString('base64');this.onload()}}}
test('printer requires explicit pairing, retains code only in memory, clears invalid connection',async()=>{
 globalThis.window={};let calls=0
 await assert.rejects(getPrinterStatus(),/PRINTER_PAIRING_REQUIRED/)
 await assert.rejects(pairPrinter('invalid'),/PRINTER_PAIRING_CODE_INVALID/)
 globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,'http://127.0.0.1:20253/v1/status');assert.equal(options.credentials,'omit');assert.equal(options.headers.Authorization,'Bearer '+'a'.repeat(43));return Response.json({data:{printer:'READY'}})}
 assert.equal((await pairPrinter('a'.repeat(43))).printer,'READY');assert.equal(calls,1)
 globalThis.fetch=async()=>{throw new Error('offline')}
 await assert.rejects(pairPrinter('a'.repeat(43)),/PRINTER_APP_UNAVAILABLE/);await assert.rejects(getPrinterStatus(),/PRINTER_PAIRING_REQUIRED/)
})
test('print fetches exact authenticated kiosk result and submits fixed 4R profile',async()=>{
 globalThis.window={};globalThis.location={origin:'https://nxbooth.gennexbyte.com'};reader();const calls=[]
 globalThis.fetch=async(url,options)=>{
  calls.push({url,options})
  if(url.endsWith('/status'))return Response.json({data:{printer:'READY'}})
  if(url.endsWith('/image')){assert.equal(options.credentials,'same-origin');return new Response(image,{headers:{'Content-Type':'image/png'}})}
  const p=JSON.parse(options.body);assert.equal(p.profile,'classic-two-strips-4r');assert.equal(p.resultId,'result-1');assert.deepEqual(Buffer.from(p.base64,'base64'),image);return Response.json({data:{status:'ACCEPTED'}})
 }
 await pairPrinter('a'.repeat(43));assert.equal((await submitPrint('result-1','CLASSIC','/api/kiosk/web/results/result-1/image')).status,'ACCEPTED')
 assert.equal(calls.length,3);assert.equal(calls[2].url,'http://127.0.0.1:20253/v1/print')
 for(const url of ['https://evil.example/image','/api/results/result-1/image','/api/kiosk/web/results/result-2/image','/api/kiosk/web/results/result-1/image?token=bad'])await assert.rejects(submitPrint('result-1','CLASSIC',url),/PRINT_IMAGE_URL_INVALID/)
 assert.equal(calls.length,3)
})
test('non-image and oversized results never reach adapter',async()=>{
 globalThis.window={};globalThis.location={origin:'https://nxbooth.gennexbyte.com'};reader();let type='text/html',length='10',printCalls=0
 globalThis.fetch=async(url)=>{if(url.endsWith('/status'))return Response.json({data:{printer:'READY'}});if(url.endsWith('/print')){printCalls++;assert.fail()};return new Response(image,{headers:{'Content-Type':type,'Content-Length':length}})}
 await pairPrinter('a'.repeat(43));await assert.rejects(submitPrint('r1','ADVANCED','/api/kiosk/web/results/r1/image'),/PRINT_IMAGE_INVALID/)
 type='image/png';length=String(17*1024*1024);await assert.rejects(submitPrint('r1','ADVANCED','/api/kiosk/web/results/r1/image'),/PRINT_IMAGE_TOO_LARGE/);assert.equal(printCalls,0)
})
test('lost submit response is unknown; receipt can be reconciled without reprinting',async()=>{
 globalThis.window={};globalThis.location={origin:'https://nxbooth.gennexbyte.com'};reader();let submissions=0
 globalThis.fetch=async(url)=>{if(url.endsWith('/status'))return Response.json({data:{printer:'READY'}});if(url.endsWith('/image'))return new Response(image,{headers:{'Content-Type':'image/png'}});if(url.includes('/jobs/'))return Response.json({data:{status:'ACCEPTED'}});submissions++;throw new Error('connection lost')}
 await pairPrinter('a'.repeat(43));await assert.rejects(submitPrint('r1','BASIC','/api/kiosk/web/results/r1/image'),/PRINT_OUTCOME_UNKNOWN/);assert.equal((await getPrintJob('r1')).status,'ACCEPTED');assert.equal(submissions,1)
})

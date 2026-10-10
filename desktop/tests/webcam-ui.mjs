import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const root=await mkdtemp('/srv/photobooth/tmp/webcam-ui-');
let app;
try{
 app=await electron.launch({timeout:30000,args:[resolve('electron/main.mjs'),'--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'],env:{...process.env,PHBO_DESKTOP_TEST:'1',PHBO_DEVICE_MODE:'hardware',PHBO_TEST_DATA:root,PHBO_WEB_BRIDGE_TEST:'1',PHBO_OPERATOR_PIN:'123456',PHBO_KIOSK_API_KEY:''}});
 const page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.getByRole('heading',{name:'Abadikan momenmu.'}).waitFor();
 assert.equal((await page.evaluate(()=>window.nxbooth.printerPairing())).error.code,'OPERATOR_REQUIRED');
 await page.getByRole('button',{name:'Basic',exact:false}).click();await page.getByRole('button',{name:'Mulai sesi'}).click();
 await page.waitForFunction(()=>document.querySelector('video')?.videoWidth>0);
 await page.getByRole('button',{name:'Ambil foto',exact:true}).click();
 await page.getByRole('heading',{name:'Periksa foto kamu.'}).waitFor();
 const state=await page.evaluate(()=>window.nxbooth.state());assert.equal(state.ok,true);assert.equal(state.data.session.captures.length,1);assert.ok(state.data.session.captures[0].url.startsWith('data:image/jpeg;base64,'));
 assert.equal(state.data.device.simulated,false);assert.equal(await page.locator('video').count(),0);
 await page.getByRole('button',{name:'Operator',exact:true}).click();await page.getByLabel('PIN operator').fill('123456');await page.getByRole('button',{name:'Buka',exact:true}).click();
 await page.getByRole('button',{name:'Tampilkan kode koneksi browser'}).click();
 const code=await page.getByLabel('Kode koneksi printer (tab browser)').inputValue();assert.match(code,/^[A-Za-z0-9_-]{43}$/);
 const pairing=await page.evaluate(()=>window.nxbooth.printerPairing());
 const response=await fetch('http://127.0.0.1:'+pairing.data.port+'/v1/status',{headers:{Origin:'https://nxbooth.gennexbyte.com',Authorization:'Bearer '+code}});
 assert.equal(response.status,200);assert.equal((await response.json()).data.printer,'PRINTER_NOT_CONNECTED');
 await page.getByRole('button',{name:'Kunci panel'}).click();await page.getByLabel('Kode koneksi printer (tab browser)').waitFor({state:'detached'});
 assert.deepEqual(errors,[]);
 console.log('PASS: actual Electron webcam capture with fake test camera, validated JPEG IPC, operator-only ephemeral pairing and real .NET device status. No physical hardware tested.');
}finally{await app?.close();await rm(root,{recursive:true,force:true})}

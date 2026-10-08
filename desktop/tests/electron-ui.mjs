import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const data=await mkdtemp(join(tmpdir(),'nxbooth-electron-'));const fixture=join(data,'fixture.png');
await writeFile(fixture,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
let app;
try{
 app=await electron.launch({timeout:30000,args:[resolve('electron/main.mjs'),'--no-sandbox'],env:{...process.env,PHBO_DESKTOP_TEST:'1',PHBO_DEVICE_MODE:'simulated',PHBO_TEST_DATA:data,PHBO_TEST_FIXTURE:fixture,PHBO_OPERATOR_PIN:'123456',PHBO_KIOSK_API_KEY:''}});
 const page=await app.firstWindow();await page.getByRole('heading',{name:'Abadikan momenmu.'}).waitFor();
 const prefs=await app.evaluate(({BrowserWindow})=>{const p=BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();return {sandbox:p.sandbox,contextIsolation:p.contextIsolation,nodeIntegration:p.nodeIntegration};});
 assert.deepEqual(prefs,{sandbox:true,contextIsolation:true,nodeIntegration:false});
 assert.equal(await page.evaluate(async()=>{try{await fetch('https://example.com');return 'allowed';}catch{return 'blocked';}}),'blocked');
 assert.equal(await page.evaluate(()=>typeof window.require),'undefined');assert.equal(await page.evaluate(()=>typeof window.process),'undefined');
 await page.getByRole('button',{name:'Basic',exact:false}).click();await page.getByRole('button',{name:'Mulai sesi'}).click();
 await page.getByRole('button',{name:'Ambil foto'}).click();await page.getByRole('heading',{name:'Periksa foto kamu.'}).waitFor();
 assert.equal(await page.locator('img').count(),1);
 await page.waitForFunction(()=>document.querySelector('img')?.naturalWidth>0);
 await page.getByRole('button',{name:'Proses foto'}).click();await page.getByRole('alert').filter({hasText:'Backend belum dikonfigurasi'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Simulasi cetak',exact:true}).count(),0);
 await page.getByRole('button',{name:'Operator',exact:true}).click();await page.getByLabel('PIN operator').fill('1111');await page.getByRole('button',{name:'Buka',exact:true}).click();await page.getByRole('alert').filter({hasText:'PIN tidak sesuai'}).waitFor();
 await page.getByLabel('PIN operator').fill('123456');await page.getByRole('button',{name:'Buka',exact:true}).click();await page.getByRole('button',{name:'Tutup sesi'}).click();await page.getByRole('heading',{name:'Abadikan momenmu.'}).waitFor();
 await page.screenshot({path:join(data,'desktop-ui.png'),fullPage:true});
 console.log('PASS: Electron sandbox/preload, capture, backend error, operator PIN and session reset.');
}catch(e){if(app){for(const w of await app.windows())console.error(await w.locator('body').innerText().catch(()=>''));}throw e;}
finally{await app?.close();await rm(data,{recursive:true,force:true});}

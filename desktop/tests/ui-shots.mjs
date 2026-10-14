// Dev tool: saves screenshots of the main desktop screens (simulated devices) to the directory in argv[2].
import {_electron as electron} from 'playwright';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const out=resolve(process.argv[2]||'ui-shots');await mkdir(out,{recursive:true});
const data=await mkdtemp(join(tmpdir(),'nxbooth-shots-'));const fixture=join(data,'fixture.png');
await writeFile(fixture,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
let app;
try{
 app=await electron.launch({timeout:30000,args:[resolve('electron/main.mjs'),'--no-sandbox'],env:{...process.env,PHBO_DESKTOP_TEST:'1',PHBO_DEVICE_MODE:'simulated',PHBO_TEST_DATA:data,PHBO_TEST_FIXTURE:fixture,PHBO_OPERATOR_PIN:'123456',PHBO_KIOSK_API_KEY:''}});
 const page=await app.firstWindow();await page.setViewportSize({width:1280,height:800});
 await page.getByRole('heading',{name:'Cek perangkat'}).waitFor();await page.waitForTimeout(400);await page.screenshot({path:join(out,'1-check.png')});
 await page.getByRole('button',{name:'Lanjutkan'}).click();await page.getByRole('heading',{name:'Abadikan momenmu.'}).waitFor();await page.screenshot({path:join(out,'2-mode.png')});
 await page.getByRole('button',{name:'Basic',exact:false}).click();await page.getByRole('button',{name:'Mulai sesi'}).waitFor();await page.screenshot({path:join(out,'3-style.png')});
 await page.getByRole('button',{name:'Mulai sesi'}).click();await page.getByRole('button',{name:'Ambil foto'}).waitFor();await page.screenshot({path:join(out,'4-capture.png')});
 await page.getByRole('button',{name:'Ambil foto'}).click();await page.getByRole('heading',{name:'Periksa foto kamu.'}).waitFor();await page.waitForTimeout(300);await page.screenshot({path:join(out,'5-review.png')});
 await page.getByRole('button',{name:'Menu staf',exact:true}).click();await page.getByLabel('PIN staf').fill('123456');await page.getByRole('button',{name:'Buka',exact:true}).click();await page.getByText('Versi terpasang',{exact:false}).waitFor();await page.screenshot({path:join(out,'6-staff.png')});
}finally{await app?.close();await rm(data,{recursive:true,force:true});}

import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
// First run with account login: device code shown, approved on "the web", optional lock PIN, staff menu, logout.
const TOKEN='t'.repeat(64);let approved=false;const bearers=[],reports=[];
const server=createServer((req,res)=>{
 const reply=(code,body)=>res.writeHead(code,{'content-type':'application/json'}).end(JSON.stringify(body));
 if(req.headers.authorization)bearers.push(req.headers.authorization);
 if(req.method==='POST'&&req.url==='/api/v1/desktop/device/code')return reply(201,{data:{device_code:'d'.repeat(43),user_code:'ABCD-2345',verification_url:'https://nxbooth.example/kiosk/activate',expires_in:600,interval:1}});
 if(req.method==='POST'&&req.url==='/api/v1/desktop/device/token')return reply(200,{data:approved?{status:'approved',token:TOKEN,expires_at:new Date(Date.now()+864e5).toISOString(),staff:{name:'Staf Uji',email:'staf@example.com'}}:{status:'pending'}});
 if(req.method==='POST'&&req.url==='/api/v1/desktop/diagnostics'){let b='';req.on('data',c=>b+=c);req.on('end',()=>{reports.push({auth:req.headers.authorization,body:JSON.parse(b)});reply(201,{data:{id:'abc123',stored:true}});});return;}
 if(req.method==='GET'&&/^\/api\/v1\/(frames|templates|experiences)$/.test(req.url))return reply(200,{data:[]});
 reply(404,{error:{code:'NOT_FOUND'}});
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const data=await mkdtemp(join(tmpdir(),'nxbooth-setup-'));
const env={...process.env,PHBO_DESKTOP_TEST:'1',PHBO_TEST_LOGIN:'1',PHBO_DEVICE_MODE:'simulated',PHBO_TEST_DATA:data,PHBO_KIOSK_API_KEY:'',PHBO_TEST_ORIGINS:JSON.stringify({control:base,media:base,storage:base,web:base})};delete env.PHBO_OPERATOR_PIN;
let app;
try{
 app=await electron.launch({timeout:30000,args:[resolve('electron/main.mjs'),'--no-sandbox'],env});
 const page=await app.firstWindow();
 await page.getByRole('heading',{name:'Masuk ke NXBooth'}).waitFor();
 await page.getByLabel('Kode aktivasi').getByText('ABCD-2345').waitFor();
 await page.getByText('https://nxbooth.example/kiosk/activate').waitFor();
 assert.equal(await page.getByRole('button',{name:'Menu staf'}).count(),0,'no staff menu before login');
 assert.equal((await page.evaluate(()=>window.nxbooth.logout())).error.code,'OPERATOR_REQUIRED');
 approved=true; // staff approves on the web
 await page.getByRole('heading',{name:'Buat PIN kunci layar'}).waitFor({timeout:15000});
 await page.getByText('Masuk sebagai Staf Uji').waitFor();
 await page.getByLabel('PIN (minimal 4 karakter)').fill('2468');await page.getByLabel('Ulangi PIN').fill('1357');
 await page.getByRole('button',{name:'Simpan PIN'}).click();await page.getByRole('alert').filter({hasText:'Konfirmasi PIN tidak sama'}).waitFor();
 await page.getByLabel('Ulangi PIN').fill('2468');await page.getByRole('button',{name:'Simpan PIN'}).click();
 await page.getByRole('heading',{name:'Cek perangkat'}).waitFor();
 assert.ok(bearers.includes('Bearer '+TOKEN),'catalog requests use the device token, not a shared key');
 assert.equal((await page.evaluate(()=>window.nxbooth.openStaff())).error.code,'PIN_REQUIRED','staff menu needs the lock PIN once set');
 await page.getByRole('button',{name:'Menu staf',exact:true}).click();
 await page.getByLabel('PIN staf').fill('0000');await page.getByRole('button',{name:'Buka',exact:true}).click();await page.getByRole('alert').filter({hasText:'PIN tidak sesuai'}).waitFor();
 await page.getByLabel('PIN staf').fill('2468');await page.getByRole('button',{name:'Buka',exact:true}).click();
 await page.getByText('Masuk sebagai Staf Uji').first().waitFor();
 assert.equal(await page.getByRole('button',{name:'Cek update'}).isDisabled(),false,'logged in, so update check is available');
 // Exercise the real main -> preload -> React progress subscription, without launching a Windows installer on Linux.
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('desktop:update-progress',{stage:'downloading',bytes:1048576,total:4194304,percent:25}));
 await page.getByText('Mengunduh update…',{exact:true}).waitFor();
 await page.getByText('25% · 1 / 4 MB',{exact:true}).waitFor();
 assert.equal(await page.getByRole('progressbar',{name:'Progres unduhan update'}).getAttribute('value'),'25');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('desktop:update-progress',{stage:'verifying',signature:true,bytes:4194304,total:4194304,percent:100}));
 await page.getByText('Memeriksa tanda tangan…',{exact:true}).waitFor();
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('desktop:update-progress',{stage:'installing',bytes:4194304,total:4194304,percent:100}));
 await page.getByText('Memasang update… aplikasi akan terbuka kembali.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Tes kamera Canon'}).click();
 await page.getByRole('alert').filter({hasText:'hanya berjalan di Windows'}).waitFor(); // honest failure off Windows, no fake camera result
 await page.getByRole('button',{name:'Kirim log ke server'}).click();
 await page.getByText('Terkirim (kode abc123)').waitFor();
 assert.equal(reports.length,1);assert.equal(reports[0].auth,'Bearer '+TOKEN,'log is sent with the device token');
 assert.deepEqual(Object.keys(reports[0].body).sort().filter(k=>!['startup_log','device_name','device_status'].includes(k)),['app_version','captured_at','os_version','platform']);
 await page.getByRole('button',{name:'Keluar',exact:true}).click();
 await page.getByRole('heading',{name:'Masuk ke NXBooth'}).waitFor();
 console.log('PASS: device-code login, token used for API calls, optional lock PIN, staff menu, camera test refusal off Windows, diagnostics upload, logout.');
}catch(e){if(app){for(const w of await app.windows())console.error(await w.locator('body').innerText().catch(()=>''));}throw e;}
finally{await app?.close();server.close();await rm(data,{recursive:true,force:true});}

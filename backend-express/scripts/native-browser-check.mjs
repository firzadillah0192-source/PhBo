import assert from 'node:assert/strict';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Optional acceptance against a real disposable Express API and native Redis
// worker. API responses are never intercepted or replaced by browser fixtures.
const api=process.env.NXBOOTH_NATIVE_API_URL;
assert.ok(api&&/^http:\/\/127\.0\.0\.1:\d+$/.test(api),'Use an isolated loopback Express listener');
const root=resolve(import.meta.dirname,'../..'),frontend=resolve(root,'frontend');
const output=process.env.NXBOOTH_NATIVE_SCREENSHOTS||'/tmp/nxbooth-native-browser-output';
const {chromium,devices}=await import(process.env.NXBOOTH_PLAYWRIGHT_MODULE||'playwright-core');
const {preview}=await import(pathToFileURL(resolve(frontend,'node_modules/vite/dist/node/index.js')));
// Exercise the production bundle. Development StrictMode deliberately mounts
// effects twice and can consume a claim response before its second mount.
const vite=await preview({root:frontend,configFile:false,logLevel:'silent',preview:{host:'127.0.0.1',port:0,proxy:{'/api':{target:api,changeOrigin:false}}}});
let browser;
try{
  await mkdir(output,{recursive:true});const port=vite.httpServer.address().port,base=`http://127.0.0.1:${port}`;
  browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
  const portrait=await readFile(resolve(root,'templates/_preview_sources/portrait-default.png'));const reports=[];
  for(const [name,options] of [['desktop',{viewport:{width:1440,height:1000}}],['android-chrome',devices['Pixel 7']],['ipad-layout',devices['iPad (gen 7)']]]){
    const context=await browser.newContext({...options,reducedMotion:'reduce',permissions:['camera']});const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base,{waitUntil:'networkidle'});await page.getByRole('heading',{name:/Moments, made/}).waitFor();assert.equal(await page.locator('.credit-pill').count(),0);assert.ok(await page.locator('.landing-experience-card').count()>0);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:resolve(output,`${name}-landing.png`),fullPage:true});
    await page.getByRole('link',{name:/^Try NXBooth Free/}).first().click();await page.getByRole('heading',{name:'Choose how you want to create.'}).waitFor();assert.equal(await page.locator('.landing-mode-grid article').count(),3);
    for(const mode of ['Classic','Basic','Advanced']){
      await page.evaluate(()=>sessionStorage.clear());await page.goto(base+'/create',{waitUntil:'networkidle'});await page.getByRole('link',{name:new RegExp(`^Choose ${mode}`)}).click();
      if(mode==='Classic'){
        await page.getByRole('heading',{name:'Choose your frame.',exact:true}).waitFor();const layouts=await (await context.request.get(base+'/api/classic/layouts')).json();const count=layouts[0].shot_count;
        await page.getByRole('button',{name:/Continue to camera/}).click();await page.locator('.classic-capture').waitFor();
        if(name==='desktop'){
          await page.locator('.camera-actions').getByRole('button',{name:'Open camera',exact:true}).click();await page.getByRole('button',{name:'Start photo 1 countdown',exact:true}).click();
          for(let shot=1;shot<=count;shot++){await page.getByRole('heading',{name:`Photo ${shot} of ${count}`,exact:true}).waitFor({timeout:20000});if(shot===1){await page.getByRole('button',{name:/^Retake photo/}).click();await page.getByRole('heading',{name:`Photo 1 of ${count}`,exact:true}).waitFor();}await page.getByRole('button',{name:/^Next/}).click();}
        }else{
          const chooserPromise=page.waitForEvent('filechooser');await page.getByRole('button',{name:`Choose ${count} photos`,exact:true}).click();const chooser=await chooserPromise;await chooser.setFiles(Array.from({length:count},(_,index)=>({name:`internal-demo-${index}.png`,mimeType:'image/png',buffer:portrait})));
        }
      }else{
        await page.getByRole('heading',{name:mode==='Basic'?'Choose your studio.':'Choose your world.',exact:true}).waitFor();
        if(mode==='Advanced'){
          await page.locator('.look-card').first().click();await page.getByRole('button',{name:/Choose frame style/}).click();await page.getByRole('heading',{name:'Choose a frame style.'}).waitFor();await page.locator('.advanced-style-card').filter({hasText:'modern'}).first().click();await page.getByRole('button',{name:'Sparkles',exact:true}).click();
        }
        await page.getByRole('button',{name:/Continue to photo/}).click();await page.locator('.photo-stage').waitFor();assert.equal(await page.getByRole('button',{name:'Upload photo',exact:true}).isEnabled(),true);
        const chooserPromise=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Upload photo',exact:true}).click();const chooser=await chooserPromise;await chooser.setFiles({name:'internal-demo.png',mimeType:'image/png',buffer:portrait});
        await page.locator('.review-stage').waitFor({timeout:20000});await page.reload({waitUntil:'networkidle'});await page.locator('.review-stage').waitFor();
        if(mode==='Advanced')assert.match(await page.locator('.advanced-review-summary').textContent(),/modern.*Sparkles/is);
        await page.locator('.review-create .customer-solid-button').click();
      }
      await page.locator('.result-stage').waitFor({timeout:60000});await page.waitForFunction(()=>document.querySelector('.result-stage img')?.naturalWidth>0);await page.screenshot({path:resolve(output,`${name}-${mode.toLowerCase()}-result.png`),fullPage:true});
      const resultId=new URL(page.url()).pathname.split('/').at(-1);const metadata=await (await context.request.get(base+`/api/results/${resultId}`)).json();assert.equal(metadata.result_id,resultId);assert.equal((await context.request.get(base+metadata.download_url)).status(),200);
      await page.locator('.result-stage svg').first().waitFor();
      const token=await page.evaluate(id=>sessionStorage.getItem(`photobooth:result-claim:${id}`),resultId);assert.ok(token);
      const publicPage=await context.newPage();await publicPage.goto(base+'/r/'+encodeURIComponent(token));await publicPage.waitForFunction(()=>document.querySelector('.public-photo-viewer img')?.naturalWidth>0);await publicPage.close();
    }
    await page.goto(base+'/admin',{waitUntil:'networkidle'});await page.getByLabel('Admin token').fill('test-admin-key');await page.getByRole('button',{name:'Unlock admin'}).click();await page.locator('.admin-metric-grid').waitFor({timeout:20000});await page.screenshot({path:resolve(output,`${name}-admin.png`),fullPage:true});
    assert.deepEqual(errors,[]);reports.push({name,passed:true,checks:['landing','published previews','three modes','Classic real compositor','Basic native provider adapter','Advanced native provider adapter','Redis consumer','selection refresh','download','shared QR','Admin session'],provider:'test double; no live provider call'});await context.close();
  }
  await writeFile(resolve(output,'report.json'),JSON.stringify(reports,null,2));console.log(JSON.stringify({browserCasesPassed:reports.length,output}));
}finally{await browser?.close();await new Promise(resolve=>vite.httpServer.close(resolve));}

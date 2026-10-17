import { app, BrowserWindow, ipcMain, dialog, protocol, net, safeStorage, shell, nativeImage } from 'electron';
import { join, dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir, appendFile, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Journal } from '../shared/journal.mjs';
import { Bridge } from '../shared/bridge.mjs';
import { Secrets } from '../shared/secrets.mjs';
import { Runtime } from '../shared/runtime.mjs';
import { origins, UpdateClient, DeviceClient, DiagnosticsClient, observeNetwork } from '../shared/clients.mjs';
import { ActivityLog } from '../shared/activity-log.mjs';
import { buildReport } from '../shared/diagnostics.mjs';
import { EventStore, eventSchema, DEFAULT_TIMING } from '../shared/event.mjs';
import { release as osRelease } from 'node:os';
import { DeviceLogin } from '../shared/login.mjs';
import { PIN_ID, KEY_ID, validPin, hashPin, checkPin } from '../shared/operator.mjs';
import { Updater } from '../shared/updater.mjs';
import { spawn } from 'node:child_process';
import {PrinterService,startPrinterServer,WEB_KIOSK_ORIGIN} from '../shared/printer-service.mjs';
const here=dirname(fileURLToPath(import.meta.url));
protocol.registerSchemesAsPrivileged([{scheme:'nxbooth',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
async function reportStartupFailure(error){
  const code=/^[A-Z0-9_]+$/.test(error?.message)?error.message:'STARTUP_ERROR';
  const detail=String(error?.stack||error?.message||error).slice(0,2000);
  console.error('DESKTOP_START_FAILED',code);
  let where='';
  try{where=join(app.getPath('userData'),'startup-error.log');await mkdir(dirname(where),{recursive:true});await appendFile(where,`${new Date().toISOString()} ${code}\n${detail}\n\n`);}catch{where='';}
  try{dialog.showErrorBox('NXBooth Desktop tidak bisa dimulai',`Kode: ${code}\n\n${detail.split('\n').slice(0,4).join('\n')}${where?`\n\nLog: ${where}`:''}`);}catch{}
}
let win;
if(!app.requestSingleInstanceLock()){app.whenReady().then(()=>{dialog.showErrorBox('NXBooth Desktop sudah berjalan','Aplikasi sudah terbuka (mungkin tersembunyi). Tutup lewat Task Manager (NXBooth Desktop), lalu jalankan lagi.');app.quit();}).catch(()=>app.quit());}else app.whenReady().then(async()=>{
  const test=!app.isPackaged&&process.env.PHBO_DESKTOP_TEST==='1';
  if(test&&process.env.PHBO_TEST_DATA)app.setPath('userData',process.env.PHBO_TEST_DATA);
  const root=app.getPath('userData'),assets=join(root,'assets');await mkdir(assets,{recursive:true});
  rm(join(assets,'updates'),{recursive:true,force:true}).catch(()=>{}); // installers downloaded by an earlier update are no longer needed once the app has restarted
  let runtime,config;
  const activity=new ActivityLog({dir:root,send:async(text,note)=>{
    if(!runtime?.apiKey)throw new Error('BACKEND_NOT_CONFIGURED');
    return new DiagnosticsClient(config,runtime.apiKey).send(buildReport({version:app.getVersion(),platform:process.platform,osVersion:osRelease(),deviceName:process.env.COMPUTERNAME||process.env.HOSTNAME,startupLog:text,note}));
  }});
  await activity.init();observeNetwork(event=>activity.record(event));activity.record({action:'app.start',status:'ok'});activity.start();
  const journal=await Journal.open(join(root,'journal.sqlite'));
  const eventStore=new EventStore(join(root,'event.json'));await eventStore.load();
  const timing=test&&process.env.PHBO_TEST_EVENT_TIMING?{...DEFAULT_TIMING,...JSON.parse(process.env.PHBO_TEST_EVENT_TIMING)}:DEFAULT_TIMING;
  const encrypted=safeStorage.isEncryptionAvailable()&&(process.platform==='win32'||safeStorage.getSelectedStorageBackend()!=='basic_text');
  const secrets=new Secrets(join(root,'credentials'),encrypted?safeStorage:null);
  const dll=join(here,'../native/KioskBridge/bin/Release/net10.0/KioskBridge.dll');
  const simulated=process.env.PHBO_DEVICE_MODE==='simulated';
  const cameraBackend=process.platform==='win32'?'canon-sdk':'browser-webcam';
  const bridge=new Bridge(app.isPackaged?join(process.resourcesPath,'bridge/KioskBridge.exe'):(process.env.PHBO_DOTNET||'dotnet'),
    [...(app.isPackaged?[]:[dll]),'--root',assets,...(simulated?['--simulated']:[])],{onDiagnostic:event=>activity.record(event)});
  const printer=new PrinterService({bridge,journal,assets});
  let printerServer=null,printerServerError='';
  if(process.platform==='win32'||test&&process.env.PHBO_WEB_BRIDGE_TEST==='1')try{
    printerServer=await startPrinterServer(printer,{port:test?0:20253});
  }catch{printerServerError='PRINTER_APP_PORT_UNAVAILABLE';}
  let operator=false;let lastProbe=null;let unlockFailures=0;let lockedUntil=0;
  // Pinned HTTPS endpoints; renderer cannot change destinations. Only unpackaged tests may point elsewhere.
  config=test&&process.env.PHBO_TEST_ORIGINS?origins(JSON.parse(process.env.PHBO_TEST_ORIGINS),true):origins();
  let saved=null;try{saved=await secrets.get(KEY_ID)||null;}catch{}
  runtime=new Runtime({journal,bridge,assets,origins:config,apiKey:process.env.PHBO_KIOSK_API_KEY||'',secrets,printer,publicCatalog:!test,onChange:()=>{const session=runtime?.session;activity.record({action:'app.session.'+(session?.phase||'idle'),status:session?.error?'error':'ok',code:session?.error,count:session?.captures?.length});win?.webContents.send('desktop:changed');}});
  let staff=saved?.token?{name:saved.name||'',email:saved.email||''}:null;
  if(!runtime.apiKey&&saved?.token){runtime.apiKey={token:saved.token};runtime.keySource='device';}
  else if(!runtime.apiKey&&saved?.key){runtime.apiKey=saved.key;runtime.keySource='saved';}
  // Lock PIN: only keeps guests out of the staff menu (identity is the account login). PHBO_OPERATOR_PIN wins (tests, advanced).
  const envPin=process.env.PHBO_OPERATOR_PIN||'';
  let pinRecord=null;try{pinRecord=await secrets.get(PIN_ID)||null;}catch{}
  const pinSet=()=>!!(envPin||pinRecord?.hash);
  let loginSkipped=false;const gate=!test||process.env.PHBO_TEST_LOGIN==='1'; // login and PIN prompts are skipped in the older UI tests
  const login=new DeviceLogin({client:new DeviceClient(config),name:process.env.COMPUTERNAME||process.env.HOSTNAME||'Kiosk PC',
    onChange:()=>{win?.webContents.send('desktop:changed');},
    onApproved:async r=>{staff={name:r.staff?.name||'',email:r.staff?.email||''};await secrets.set(KEY_ID,{token:r.token,...staff});await runtime.setApiKey({token:r.token},'device');}});
  let signer='';try{signer=JSON.parse(await readFile(join(process.resourcesPath,'update-signer.json'),'utf8')).thumbprint||'';}catch{}
  let updateBusy=false;
  const updater=()=>{
    if(!app.isPackaged)throw new Error('UPDATE_ONLY_PACKAGED');
    if(!runtime.apiKey)throw new Error('BACKEND_NOT_CONFIGURED');
    return new Updater({client:new UpdateClient(config,runtime.apiKey),bridge,dir:join(assets,'updates'),version:app.getVersion(),signer,
      sessionActive:()=>!!runtime.session&&runtime.session.phase!=='FINISHED',
      onProgress:progress=>win?.webContents.send('desktop:update-progress',progress),
      launch:async file=>{
        // Quit only after Windows accepted the process; an asynchronous spawn error must leave the app open.
        await new Promise((resolve,reject)=>{
          const child=spawn(file,['/S','--updated','--force-run'],{detached:true,stdio:'ignore',windowsHide:true});
          child.once('error',()=>reject(new Error('UPDATE_LAUNCH_FAILED')));
          child.once('spawn',()=>{child.unref();resolve();});
        });
        setTimeout(()=>app.quit(),500);
      }});
  };
  const view=async()=>({...await runtime.state(),cameraBackend,activity:activity.status(),version:app.getVersion(),keyFromEnvironment:runtime.keySource==='env'&&!!runtime.apiKey,
    loginRequired:!runtime.apiKey&&gate&&!loginSkipped,login:login.state,staff:runtime.keySource==='device'?staff:null,
    event:eventStore.get()?{...eventStore.get(),timing}:null,pinSet:pinSet(),pinPrompt:!!runtime.apiKey&&!envPin&&!pinRecord&&gate});
  const dist=resolve(here,'../dist');
  protocol.handle('nxbooth',request=>{const url=new URL(request.url);const path=resolve(dist,'.'+decodeURIComponent(url.pathname==='/' ? '/index.html':url.pathname));const rel=relative(dist,path);
    if(url.host!=='app'||rel.startsWith('..')||isAbsolute(rel))return new Response('Forbidden',{status:403});return net.fetch(pathToFileURL(path).href);});
  win=new BrowserWindow({width:1280,height:800,minWidth:800,minHeight:600,backgroundColor:'#11151e',autoHideMenuBar:true,webPreferences:{preload:join(here,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(event,url)=>{if(url!=='nxbooth://app/index.html')event.preventDefault();});
  win.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  // Catalog art is large PNG; shrink once in the trusted process and cache on disk for a day.
  const thumbs=join(root,'thumbs');await mkdir(thumbs,{recursive:true});let thumbSlots=0;const thumbWaiters=[];
  const slot=async()=>{if(thumbSlots>=3)await new Promise(r=>thumbWaiters.push(r));thumbSlots++;};
  const release=()=>{thumbSlots--;thumbWaiters.shift()?.();};
  async function thumbnail(mode,id){
    const file=join(thumbs,`${mode}-${id}.jpg`);
    try{const st=await stat(file);if(Date.now()-st.mtimeMs<86400000)return 'data:image/jpeg;base64,'+(await readFile(file)).toString('base64');}catch{}
    await slot();
    try{
      const image=nativeImage.createFromBuffer(await runtime.catalogImage(mode,id));
      if(image.isEmpty())throw new Error('INVALID_IMAGE');
      const {width}=image.getSize();const jpg=image.resize({width:Math.min(width,420),quality:'good'}).toJPEG(78);
      await writeFile(file,jpg,{mode:0o600});return 'data:image/jpeg;base64,'+jpg.toString('base64');
    }finally{release();}
  }
  const callSchema=z.discriminatedUnion('method',[
    z.object({method:z.literal('activityEvent'),action:z.enum(['camera.preview','camera.reconnect','camera.video.decode','renderer.error','renderer.unhandled_rejection','ui.click','ui.change']),status:z.enum(['begin','ok','error','empty']),code:z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).optional(),count:z.number().int().min(0).max(1000000).optional()}).strict(),
    z.object({method:z.literal('state')}).strict(),z.object({method:z.literal('start'),mode:z.enum(['CLASSIC','BASIC','ADVANCED']),selectionId:z.string().max(128).optional(),eventName:z.string().trim().min(1).max(80).regex(/^[^\p{Cc}\p{Cf}]+$/u).optional()}).strict(),
    z.object({method:z.literal('refresh')}).strict(),
    ...['loginStart','loginCancel','loginSkip','loginShow','logout','openStaff','pinSkip'].map(method=>z.object({method:z.literal(method)}).strict()),
    z.object({method:z.literal('pinCreate'),pin:z.string().min(4).max(128)}).strict(),
    z.object({method:z.literal('setApiKey'),key:z.string().min(32).max(512).regex(/^[\x21-\x7E]+$/)}).strict(),z.object({method:z.literal('clearApiKey')}).strict(),
    z.object({method:z.literal('eventSave'),...eventSchema.shape}).strict(),
    ...['cameraOpen','cameraFrame','cameraClose','updateCheck','updateInstall','cameraProbe','diagnosticsSend','eventReset','resultClaim'].map(method=>z.object({method:z.literal(method)}).strict()),
    z.object({method:z.literal('thumbnail'),mode:z.enum(['CLASSIC','BASIC','ADVANCED']),id:z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)}).strict(),
    ...['capture','retake','process','print','finish','fixture','lock','printerPairing','openWebKiosk'].map(method=>z.object({method:z.literal(method)}).strict()),
    z.object({method:z.literal('captureWebcam'),base64:z.string().max(22*1024*1024)}).strict(),
    z.object({method:z.literal('unlock'),pin:z.string().min(4).max(128)}).strict()
  ]);
  ipcMain.handle('desktop:call',async(event,input)=>{
    const started=Date.now();let method='invalid',failed='';
    try{
      if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||event.senderFrame.url!=='nxbooth://app/index.html')throw new Error('IPC_FORBIDDEN');
      const p=callSchema.parse(input);method=p.method;
      if(p.method==='activityEvent'){const {method:_method,...record}=p;activity.record(record);return {ok:true};}
      activity.record({action:'ipc.'+method,status:'begin'});
      if(p.method==='unlock'){
        if(!pinSet())throw new Error('OPERATOR_PIN_NOT_CONFIGURED');
        if(Date.now()<lockedUntil)throw new Error('OPERATOR_LOCKED');
        const a=Buffer.from(p.pin),b=Buffer.from(envPin);const ok=envPin?a.length===b.length&&timingSafeEqual(a,b):checkPin(p.pin,pinRecord);
        if(!ok){if(++unlockFailures>=5){lockedUntil=Date.now()+60000;unlockFailures=0;}throw new Error('PIN_INVALID');}
        unlockFailures=0;operator=true;return {ok:true,data:{operator:true}};
      }
      if(p.method==='refresh'){await runtime.refreshDevices();await runtime.refreshCatalog();return {ok:true,data:await view()};}
      if(p.method==='loginStart'){await login.start();return {ok:true,data:await view()};}
      if(p.method==='loginCancel'){login.cancel();return {ok:true,data:await view()};}
      if(p.method==='loginSkip'){loginSkipped=true;return {ok:true,data:await view()};}
      if(p.method==='loginShow'){loginSkipped=false;return {ok:true,data:await view()};}
      if(p.method==='openStaff'){
        // Without a lock PIN the staff menu is open; the menu itself offers to create one.
        if(pinSet())throw new Error('PIN_REQUIRED');
        operator=true;return {ok:true,data:{operator:true}};
      }
      if(p.method==='pinCreate'){
        if(pinSet()&&!operator)throw new Error('OPERATOR_REQUIRED');
        if(envPin)throw new Error('KEY_FROM_ENVIRONMENT');
        if(!validPin(p.pin))throw new Error('PIN_INVALID');
        pinRecord=hashPin(p.pin);await secrets.set(PIN_ID,pinRecord);return {ok:true,data:await view()};
      }
      if(p.method==='pinSkip'){if(!pinRecord&&!envPin){pinRecord={skipped:true};await secrets.set(PIN_ID,pinRecord);}return {ok:true,data:await view()};}
      if(p.method==='logout'){
        if(!operator)throw new Error('OPERATOR_REQUIRED');
        if(runtime.keySource==='env'&&runtime.apiKey)throw new Error('KEY_FROM_ENVIRONMENT');
        await secrets.set(KEY_ID,{token:'',key:''});staff=null;login.cancel();await runtime.setApiKey('');return {ok:true,data:await view()};
      }
      if(p.method==='setApiKey'){
        if(!operator)throw new Error('OPERATOR_REQUIRED');
        if(runtime.keySource==='env'&&runtime.apiKey)throw new Error('KEY_FROM_ENVIRONMENT');
        await secrets.set(KEY_ID,{key:p.key});await runtime.setApiKey(p.key);return {ok:true,data:await view()};
      }
      if(p.method==='clearApiKey'){
        if(!operator)throw new Error('OPERATOR_REQUIRED');
        if(runtime.keySource==='env')throw new Error('KEY_FROM_ENVIRONMENT');
        await secrets.set(KEY_ID,{key:''});await runtime.setApiKey('');return {ok:true,data:await view()};
      }
      if(p.method==='updateCheck'){if(!operator)throw new Error('OPERATOR_REQUIRED');return {ok:true,data:await updater().check()};}
      if(p.method==='updateInstall'){
        if(!operator)throw new Error('OPERATOR_REQUIRED');
        if(updateBusy)throw new Error('UPDATE_IN_PROGRESS');
        updateBusy=true;
        try{return {ok:true,data:await updater().install()};}finally{updateBusy=false;}
      }
      if(['cameraOpen','cameraFrame','cameraClose'].includes(p.method)){
        if(cameraBackend!=='canon-sdk'||simulated)throw new Error('CAMERA_MODE_INVALID');
        if(p.method!=='cameraClose'&&(runtime.session?.phase!=='CAPTURING'||runtime.busy))throw new Error('CAPTURE_NOT_ALLOWED');
        return {ok:true,data:await bridge.call({'cameraOpen':'camera.open','cameraFrame':'camera.frame','cameraClose':'camera.close'}[p.method])};
      }
      if(p.method==='cameraProbe'){
        if(!operator)throw new Error('OPERATOR_REQUIRED');
        if(runtime.session&&runtime.session.phase!=='FINISHED')throw new Error('PROBE_SESSION_ACTIVE');
        lastProbe=await bridge.call('camera.probe');return {ok:true,data:lastProbe};
      }
      if(p.method==='diagnosticsSend'){
        if(!operator)throw new Error('OPERATOR_REQUIRED');
        if(!runtime.apiKey)throw new Error('BACKEND_NOT_CONFIGURED');
        let startupLog='';try{startupLog=(await readFile(join(root,'startup-error.log'),'utf8')).slice(-2000);}catch{}
        const status=await bridge.call('devices.status').catch(()=>({}));
        const report=buildReport({version:app.getVersion(),platform:process.platform,osVersion:osRelease(),deviceName:process.env.COMPUTERNAME||process.env.HOSTNAME,
          deviceStatus:{camera:status.camera,printer:status.printer??status.printing?.status},probe:lastProbe,startupLog});
        return {ok:true,data:await new DiagnosticsClient(config,runtime.apiKey).send(report)};
      }
      if(p.method==='eventSave'){
        if(!operator)throw new Error('OPERATOR_REQUIRED');
        const {method:_m,...input}=p;
        if(runtime.catalogLoaded)for(const t of input.templates)if(!runtime.catalog[t.mode]?.some(x=>x.id===t.id))throw new Error('EVENT_TEMPLATE_UNKNOWN');
        if(input.active&&runtime.session&&runtime.session.phase!=='FINISHED')throw new Error('SESSION_ACTIVE');
        await eventStore.save(input);return {ok:true,data:await view()};
      }
      if(p.method==='eventReset'){
        // Guests restart the event kiosk without the staff PIN; only while event mode is on.
        if(!eventStore.get()?.active)throw new Error('EVENT_MODE_OFF');
        if(runtime.session)await runtime.finish();return {ok:true,data:await view()};
      }
      if(p.method==='resultClaim')return {ok:true,data:await runtime.resultClaim()};
      if(p.method==='thumbnail')return {ok:true,data:await thumbnail(p.mode,p.id)};
      if(p.method==='lock'){operator=false;return {ok:true,data:{operator:false}};}
      if(p.method==='printerPairing'){
        if(!operator)throw new Error('OPERATOR_REQUIRED');
        if(!printerServer)throw new Error(printerServerError||'PRINTER_APP_WINDOWS_REQUIRED');
        return {ok:true,data:{code:printerServer.token,port:printerServer.port}};
      }
      if(p.method==='openWebKiosk'){
        if(!operator)throw new Error('OPERATOR_REQUIRED');
        await shell.openExternal(WEB_KIOSK_ORIGIN+'/kiosk');
        return {ok:true,data:{opened:true}};
      }
      if(p.method==='captureWebcam'){
        if(simulated||cameraBackend==='canon-sdk')throw new Error('CAMERA_MODE_INVALID');
        if(p.base64.length%4||! /^[A-Za-z0-9+/]*={0,2}$/.test(p.base64))throw new Error('INVALID_IMAGE');
        const bytes=Buffer.from(p.base64,'base64');
        if(bytes.toString('base64')!==p.base64||bytes.length>16*1024*1024)throw new Error('INVALID_IMAGE');
        const image=nativeImage.createFromBuffer(bytes),size=image.getSize();
        if(image.isEmpty()||!size.width||!size.height||size.width*size.height>25000000)throw new Error('INVALID_IMAGE');
        return {ok:true,data:await runtime.captureBytes(bytes)};
      }
      if(p.method==='fixture'){
        if(!operator)throw new Error('OPERATOR_REQUIRED');
        const selected=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Foto JPEG/PNG',extensions:['jpg','jpeg','png']}]});
        if(!selected.canceled)await runtime.setFixture(selected.filePaths[0]);return {ok:true,data:await runtime.state()};
      }
      if(p.method==='finish'&&runtime.session?.phase!=='RESULT_READY'&&!operator)throw new Error('OPERATOR_REQUIRED');
      const data=p.method==='state'?await view():p.method==='start'?await runtime.start(p.mode,p.selectionId,p.eventName):await runtime[p.method]();
      return {ok:true,data};
    }catch(e){failed=/^[A-Z][A-Z0-9_]{0,79}$/.test(e.message)?e.message:'DESKTOP_ERROR';return {ok:false,error:{code:failed}};}
    finally{if(method!=='activityEvent')activity.record({action:'ipc.'+method,status:failed?'error':'ok',code:failed||undefined,ms:Date.now()-started});}
  });
  win.webContents.session.setPermissionCheckHandler((wc,permission,origin)=>wc===win.webContents&&permission==='media'&&origin==='nxbooth://app');
  win.webContents.session.setPermissionRequestHandler((wc,permission,callback,details)=>callback(wc===win.webContents&&permission==='media'&&details.requestingUrl?.startsWith('nxbooth://app/')&&!(details.mediaTypes||[]).includes('audio')));
  win.webContents.on('render-process-gone',()=>activity.record({action:'renderer.process',status:'error',code:'RENDER_PROCESS_GONE'}));
  win.webContents.on('unresponsive',()=>activity.record({action:'renderer.process',status:'error',code:'RENDERER_UNRESPONSIVE'}));
  let exiting=false;
  app.on('before-quit',event=>{
    if(exiting)return;event.preventDefault();exiting=true;
    activity.record({action:'app.quit',status:'ok'});
    Promise.race([activity.stop(),new Promise(resolve=>setTimeout(resolve,1000))]).finally(()=>{printerServer?.close();bridge.close();journal.close();app.quit();});
  });
  await runtime.initialize();
  if(test&&process.env.PHBO_TEST_FIXTURE)await runtime.setFixture(process.env.PHBO_TEST_FIXTURE);
  await win.loadURL('nxbooth://app/index.html');
  app.on('second-instance',()=>{if(win.isMinimized())win.restore();win.focus();});
  app.on('window-all-closed',()=>app.quit());
}).catch(async error=>{await reportStartupFailure(error);app.quit();});

import { app, BrowserWindow, ipcMain, dialog, protocol, net, safeStorage, shell, nativeImage } from 'electron';
import { join, dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Journal } from '../shared/journal.mjs';
import { Bridge } from '../shared/bridge.mjs';
import { Secrets } from '../shared/secrets.mjs';
import { Runtime } from '../shared/runtime.mjs';
import { origins } from '../shared/clients.mjs';
import {PrinterService,startPrinterServer,WEB_KIOSK_ORIGIN} from '../shared/printer-service.mjs';
const here=dirname(fileURLToPath(import.meta.url));
protocol.registerSchemesAsPrivileged([{scheme:'nxbooth',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
if(!app.requestSingleInstanceLock()){app.quit();}else app.whenReady().then(async()=>{
  const test=!app.isPackaged&&process.env.PHBO_DESKTOP_TEST==='1';
  if(test&&process.env.PHBO_TEST_DATA)app.setPath('userData',process.env.PHBO_TEST_DATA);
  const root=app.getPath('userData'),assets=join(root,'assets');await mkdir(assets,{recursive:true});
  const journal=await Journal.open(join(root,'journal.sqlite'));
  const encrypted=safeStorage.isEncryptionAvailable()&&(process.platform==='win32'||safeStorage.getSelectedStorageBackend()!=='basic_text');
  const secrets=new Secrets(join(root,'credentials'),encrypted?safeStorage:null);
  const dll=join(here,'../native/KioskBridge/bin/Release/net10.0/KioskBridge.dll');
  const simulated=process.env.PHBO_DEVICE_MODE==='simulated';
  const bridge=new Bridge(app.isPackaged?join(process.resourcesPath,'bridge/KioskBridge.exe'):(process.env.PHBO_DOTNET||'dotnet'),
    [...(app.isPackaged?[]:[dll]),'--root',assets,...(simulated?['--simulated']:[])]);
  const printer=new PrinterService({bridge,journal,assets});
  let printerServer=null,printerServerError='';
  if(process.platform==='win32'||test&&process.env.PHBO_WEB_BRIDGE_TEST==='1')try{
    printerServer=await startPrinterServer(printer,{port:test?0:20253});
  }catch{printerServerError='PRINTER_APP_PORT_UNAVAILABLE';}
  let win;let operator=false;let unlockFailures=0;let lockedUntil=0;
  const config=origins(); // Pinned HTTPS endpoints; renderer cannot change destinations.
  const runtime=new Runtime({journal,bridge,assets,origins:config,apiKey:process.env.PHBO_KIOSK_API_KEY||'',secrets,printer,onChange:()=>{win?.webContents.send('desktop:changed');}});
  const dist=resolve(here,'../dist');
  protocol.handle('nxbooth',request=>{const url=new URL(request.url);const path=resolve(dist,'.'+decodeURIComponent(url.pathname==='/' ? '/index.html':url.pathname));const rel=relative(dist,path);
    if(url.host!=='app'||rel.startsWith('..')||isAbsolute(rel))return new Response('Forbidden',{status:403});return net.fetch(pathToFileURL(path).href);});
  win=new BrowserWindow({width:1280,height:800,minWidth:800,minHeight:600,backgroundColor:'#11151e',autoHideMenuBar:true,webPreferences:{preload:join(here,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(event,url)=>{if(url!=='nxbooth://app/index.html')event.preventDefault();});
  win.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  const callSchema=z.discriminatedUnion('method',[
    z.object({method:z.literal('state')}).strict(),z.object({method:z.literal('start'),mode:z.enum(['CLASSIC','BASIC','ADVANCED']),selectionId:z.string().max(128).optional(),eventName:z.string().trim().min(1).max(80).regex(/^[^\p{Cc}\p{Cf}]+$/u).optional()}).strict(),
    ...['capture','retake','process','print','finish','fixture','lock','printerPairing','openWebKiosk'].map(method=>z.object({method:z.literal(method)}).strict()),
    z.object({method:z.literal('captureWebcam'),base64:z.string().max(22*1024*1024)}).strict(),
    z.object({method:z.literal('unlock'),pin:z.string().min(4).max(128)}).strict()
  ]);
  ipcMain.handle('desktop:call',async(event,input)=>{
    try{
      if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||event.senderFrame.url!=='nxbooth://app/index.html')throw new Error('IPC_FORBIDDEN');
      const p=callSchema.parse(input);
      if(p.method==='unlock'){
        const wanted=process.env.PHBO_OPERATOR_PIN||'';if(!wanted)throw new Error('OPERATOR_PIN_NOT_CONFIGURED');
        if(Date.now()<lockedUntil)throw new Error('OPERATOR_LOCKED');
        const a=Buffer.from(p.pin),b=Buffer.from(wanted);if(a.length!==b.length||!timingSafeEqual(a,b)){if(++unlockFailures>=5){lockedUntil=Date.now()+60000;unlockFailures=0;}throw new Error('PIN_INVALID');}
        unlockFailures=0;operator=true;return {ok:true,data:{operator:true}};
      }
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
        if(simulated)throw new Error('CAMERA_MODE_INVALID');
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
      const data=p.method==='state'?await runtime.state():p.method==='start'?await runtime.start(p.mode,p.selectionId,p.eventName):await runtime[p.method]();
      return {ok:true,data};
    }catch(e){return {ok:false,error:{code:/^[A-Z0-9_]+$/.test(e.message)?e.message:'DESKTOP_ERROR'}};}
  });
  win.webContents.session.setPermissionCheckHandler((wc,permission,origin)=>wc===win.webContents&&permission==='media'&&origin==='nxbooth://app');
  win.webContents.session.setPermissionRequestHandler((wc,permission,callback,details)=>callback(wc===win.webContents&&permission==='media'&&details.requestingUrl?.startsWith('nxbooth://app/')&&!(details.mediaTypes||[]).includes('audio')));
  app.on('before-quit',()=>{printerServer?.close();bridge.close();journal.close();});
  await runtime.initialize();
  if(test&&process.env.PHBO_TEST_FIXTURE)await runtime.setFixture(process.env.PHBO_TEST_FIXTURE);
  await win.loadURL('nxbooth://app/index.html');
  app.on('window-all-closed',()=>app.quit());
}).catch(error=>{console.error('DESKTOP_START_FAILED', /^[A-Z0-9_]+$/.test(error.message)?error.message:'STARTUP_ERROR');app.quit();});

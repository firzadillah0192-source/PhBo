const {contextBridge,ipcRenderer}=require('electron');
const call=input=>ipcRenderer.invoke('desktop:call',input);
contextBridge.exposeInMainWorld('nxbooth',Object.freeze({
  activityEvent:event=>call({...event,method:'activityEvent'}),
  state:()=>call({method:'state'}),start:(mode,selectionId,eventName)=>call({method:'start',mode,selectionId,eventName}),
  cameraOpen:()=>call({method:'cameraOpen'}),cameraFrame:()=>call({method:'cameraFrame'}),cameraClose:()=>call({method:'cameraClose'}),
  capture:()=>call({method:'capture'}),retake:()=>call({method:'retake'}),process:()=>call({method:'process'}),
  captureWebcam:base64=>call({method:'captureWebcam',base64}),
  print:()=>call({method:'print'}),finish:()=>call({method:'finish'}),chooseFixture:()=>call({method:'fixture'}),
  printerPairing:()=>call({method:'printerPairing'}),openWebKiosk:()=>call({method:'openWebKiosk'}),
  refresh:()=>call({method:'refresh'}),thumbnail:(mode,id)=>call({method:'thumbnail',mode,id}),
  unlock:pin=>call({method:'unlock',pin}),lock:()=>call({method:'lock'}),
  loginStart:()=>call({method:'loginStart'}),loginCancel:()=>call({method:'loginCancel'}),loginSkip:()=>call({method:'loginSkip'}),loginShow:()=>call({method:'loginShow'}),logout:()=>call({method:'logout'}),
  openStaff:()=>call({method:'openStaff'}),pinCreate:pin=>call({method:'pinCreate',pin}),pinSkip:()=>call({method:'pinSkip'}),setApiKey:key=>call({method:'setApiKey',key}),clearApiKey:()=>call({method:'clearApiKey'}),
  updateCheck:()=>call({method:'updateCheck'}),updateInstall:()=>call({method:'updateInstall'}),
  cameraProbe:()=>call({method:'cameraProbe'}),eventSave:event=>call({method:'eventSave',...event}),eventReset:()=>call({method:'eventReset'}),cameraSettingsSave:settings=>call({method:'cameraSettingsSave',...settings}),resultClaim:()=>call({method:'resultClaim'}),diagnosticsSend:()=>call({method:'diagnosticsSend'}),
  onUpdateProgress:callback=>{const handler=(_event,progress)=>callback(progress);ipcRenderer.on('desktop:update-progress',handler);return()=>ipcRenderer.removeListener('desktop:update-progress',handler);},
  onChange:callback=>{const handler=()=>callback();ipcRenderer.on('desktop:changed',handler);return()=>ipcRenderer.removeListener('desktop:changed',handler);}
}));

// Renderer-wide events carry only fixed names; form contents, button text and exception messages never cross this channel.
const trace=(action,code)=>{void call({method:'activityEvent',action,status:'error',code}).catch(()=>{});};
window.addEventListener('error',()=>trace('renderer.error','RENDERER_ERROR'));
window.addEventListener('unhandledrejection',()=>trace('renderer.unhandled_rejection','UNHANDLED_REJECTION'));
for(const type of ['click','change'])window.addEventListener(type,event=>{
 const target=event.target?.closest?.('button,input,select');if(!target)return;
 void call({method:'activityEvent',action:'ui.'+type,status:'ok',code:target.tagName}).catch(()=>{});
},true);

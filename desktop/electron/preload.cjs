const {contextBridge,ipcRenderer}=require('electron');
const call=input=>ipcRenderer.invoke('desktop:call',input);
contextBridge.exposeInMainWorld('nxbooth',Object.freeze({
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
  cameraProbe:()=>call({method:'cameraProbe'}),diagnosticsSend:()=>call({method:'diagnosticsSend'}),
  onChange:callback=>{const handler=()=>callback();ipcRenderer.on('desktop:changed',handler);return()=>ipcRenderer.removeListener('desktop:changed',handler);}
}));

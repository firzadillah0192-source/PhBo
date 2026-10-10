const {contextBridge,ipcRenderer}=require('electron');
const call=input=>ipcRenderer.invoke('desktop:call',input);
contextBridge.exposeInMainWorld('nxbooth',Object.freeze({
  state:()=>call({method:'state'}),start:(mode,selectionId,eventName)=>call({method:'start',mode,selectionId,eventName}),
  capture:()=>call({method:'capture'}),retake:()=>call({method:'retake'}),process:()=>call({method:'process'}),
  captureWebcam:base64=>call({method:'captureWebcam',base64}),
  print:()=>call({method:'print'}),finish:()=>call({method:'finish'}),chooseFixture:()=>call({method:'fixture'}),
  printerPairing:()=>call({method:'printerPairing'}),openWebKiosk:()=>call({method:'openWebKiosk'}),
  unlock:pin=>call({method:'unlock',pin}),lock:()=>call({method:'lock'}),
  onChange:callback=>{const handler=()=>callback();ipcRenderer.on('desktop:changed',handler);return()=>ipcRenderer.removeListener('desktop:changed',handler);}
}));

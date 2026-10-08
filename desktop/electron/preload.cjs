const {contextBridge,ipcRenderer}=require('electron');
const call=input=>ipcRenderer.invoke('desktop:call',input);
contextBridge.exposeInMainWorld('nxbooth',Object.freeze({
  state:()=>call({method:'state'}),start:(mode,selectionId)=>call({method:'start',mode,selectionId}),
  capture:()=>call({method:'capture'}),retake:()=>call({method:'retake'}),process:()=>call({method:'process'}),
  print:()=>call({method:'print'}),finish:()=>call({method:'finish'}),chooseFixture:()=>call({method:'fixture'}),
  unlock:pin=>call({method:'unlock',pin}),lock:()=>call({method:'lock'}),
  onChange:callback=>{const handler=()=>callback();ipcRenderer.on('desktop:changed',handler);return()=>ipcRenderer.removeListener('desktop:changed',handler);}
}));

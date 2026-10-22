import {useEffect,useRef,useState} from 'react';
import {openKioskCamera,stopCamera,captureCameraPhoto,cameraError} from '../../frontend/src/kioskCamera.js';

export const cameraMessage=code=>({CAMERA_NOT_CONNECTED:'Kamera Canon belum terhubung. Periksa USB dan daya kamera.',CAMERA_DISCONNECTED:'Koneksi kamera terputus. Periksa USB, lalu sambungkan ulang.',CAMERA_CAPTURE_FAILED:'Foto belum berhasil diterima dari kamera. Periksa kamera sebelum mencoba lagi.',CAMERA_TRANSFER_FAILED:'Foto dari kamera gagal ditransfer.',CAMERA_PREVIEW_EMPTY:'Preview Canon belum tersedia. Periksa mode kamera dan tutup aplikasi kamera lain.',ADAPTER_TIMEOUT:'Kamera tidak menjawab. Periksa koneksi dan buka ulang sesi.'})[code]||'Kamera Canon belum siap. Periksa USB dan tutup aplikasi kamera lain.';

/** Only the native SDK supplies Windows preview and shutter; browser capture is for non-Windows development. */
export function useSessionCamera(api,{active,simulated,backend}){
 const video=useRef(null),[camera,setCamera]=useState({ready:false,error:'',source:'',url:''});
 const sdk=backend==='canon-sdk';
 const [epoch,setEpoch]=useState(0);
 useEffect(()=>{
  if(!active||simulated){setCamera({ready:!!simulated,error:'',source:'',url:''});return;}
  let cancelled=false,stream,timer;
  setCamera({ready:false,error:'',source:sdk?'Canon USB':'',url:''});
  if(sdk){
   let empty=0;
   const poll=async()=>{
    try{
     const r=await api.cameraFrame();if(cancelled)return;
     if(!r.ok){
      if(r.error.code==='CAPTURE_NOT_ALLOWED'){timer=setTimeout(poll,150);return;}
      throw new Error(r.error.code);
     }
     if(r.data.url){empty=0;setCamera({ready:true,error:'',source:'Canon USB',url:r.data.url});}
     else if(++empty>=100)throw new Error('CAMERA_PREVIEW_EMPTY');
     timer=setTimeout(poll,120);
    }catch(e){if(!cancelled)setCamera(c=>({...c,ready:false,error:cameraMessage(e.message)}));}
   };
   api.cameraOpen().then(r=>{if(cancelled)return;if(!r.ok)throw new Error(r.error.code);return poll();}).catch(e=>{if(!cancelled)setCamera(c=>({...c,ready:false,error:cameraMessage(e.message)}));});
  }else{
   openKioskCamera().then(opened=>{if(cancelled){stopCamera(opened.stream);return;}stream=opened.stream;if(video.current){video.current.srcObject=stream;video.current.play().catch(()=>{});}setCamera(c=>({...c,source:opened.source}));}).catch(e=>{if(!cancelled)setCamera(c=>({...c,error:cameraError(e)}));});
  }
  return()=>{cancelled=true;clearTimeout(timer);stopCamera(stream);if(sdk)api.cameraClose().catch(()=>{});};
 },[active,simulated,sdk,api,epoch]);
 async function capture(){
  if(simulated||sdk)return api.capture();
  const file=await captureCameraPhoto(video.current);
  const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});
  return api.captureWebcam(base64);
 }
 return {...camera,video,sdk,capture,reconnect:()=>setEpoch(n=>n+1),playing:()=>setCamera(c=>({...c,ready:true}))};
}
export function CameraPreview({camera,label='Preview kamera Canon'}){
 return camera.sdk?(camera.url?<img className="sdk-preview" src={camera.url} alt={label}/>:<p role="status">{camera.error||'Menghubungkan kamera Canon…'}</p>):<video ref={camera.video} autoPlay muted playsInline aria-label={label} onPlaying={camera.playing}/>;
}

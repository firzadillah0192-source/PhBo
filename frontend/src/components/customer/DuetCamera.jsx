import React,{useEffect,useRef,useState} from 'react'
import { composeDuetStrip,getDuetOverlay,getDuetTemplate,updateDuetTemplate } from '../../api.js'
import { captureSize,drawCamera,drawCompanion } from '../../duetGeometry.js'

export default function DuetCamera({template,frame,onBack}) {
  const size=captureSize(frame)
  const video=useRef(null),canvas=useRef(null),overlays=useRef([]),alive=useRef(true),stream=useRef(null),countTimer=useRef(null),cancelCountdown=useRef(null)
  const initial={side:'left',scale:template.placement.scale},[placement,setPlacement]=useState(initial),placementRef=useRef(initial)
  const [ready,setReady]=useState(false),[error,setError]=useState(''),[captures,setCaptures]=useState([]),[countdown,setCountdown]=useState(null),[busy,setBusy]=useState(false),[result,setResult]=useState(null)
  const busyRef=useRef(false),urls=useRef(new Set()),capturesRef=useRef([])
  const urlFor=blob=>{const url=URL.createObjectURL(blob);urls.current.add(url);return url}
  useEffect(()=>{placementRef.current=placement},[placement])
  useEffect(()=>{
    alive.current=true;let disposed=false,frame
    const start=async()=>{
      try{
        await getDuetTemplate(template.id)
        const images=[]
        for(const pose of template.poses){
          const blob=await getDuetOverlay(template.id,pose.slot)
          if(disposed)return
          const image=new Image();image.src=urlFor(blob);await image.decode();images.push(image)
        }
        if(disposed)return;overlays.current=images
        if(!navigator.mediaDevices?.getUserMedia)throw new Error('Kamera memerlukan HTTPS dan browser yang mendukung akses kamera.')
        const camera=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:1280},height:{ideal:960}},audio:false})
        if(disposed){camera.getTracks().forEach(track=>track.stop());return}
        stream.current=camera;video.current.srcObject=camera;await video.current.play()
        if(disposed)return
        setReady(true)
        const draw=()=>{if(disposed)return;if(video.current?.readyState>=2){drawCamera(canvas.current,video.current);drawCompanion(canvas.current,overlays.current[Math.min(capturesRef.current.length,overlays.current.length-1)],placementRef.current)}frame=requestAnimationFrame(draw)}
        frame=requestAnimationFrame(draw)
        camera.getVideoTracks()[0]?.addEventListener('ended',()=>{if(!disposed){setReady(false);setError('Kamera terputus. Kembali lalu buka sesi foto lagi.')}})
      }catch(e){stream.current?.getTracks().forEach(track=>track.stop());if(!disposed)setError(e.name==='NotAllowedError'?'Akses kamera ditolak. Izinkan kamera di pengaturan browser, lalu buka sesi lagi.':e.message||'Kamera tidak dapat dibuka.')}
    }
    start()
    return()=>{disposed=true;alive.current=false;cancelAnimationFrame(frame);clearTimeout(countTimer.current);cancelCountdown.current?.();stream.current?.getTracks().forEach(track=>track.stop());urls.current.forEach(url=>URL.revokeObjectURL(url));urls.current.clear()}
  },[template.id])
  const snap=async()=>{
    if(busyRef.current||!ready||capturesRef.current.length>=3)return
    busyRef.current=true;setBusy(true);setError('')
    try{
      const live=await getDuetTemplate(template.id)
      if(!live.enabled||live.state!=='COMPLETED')throw new Error('Template tidak tersedia lagi. Kembali ke Template Saya.')
      if(capturesRef.current.length===0)await updateDuetTemplate(template.id,{placement:placementRef.current})
      if(!alive.current)return
      let ticks=3;setCountdown(ticks)
      await new Promise(resolve=>{cancelCountdown.current=resolve;const tick=()=>{if(!alive.current){resolve();return}ticks--;setCountdown(ticks||null);if(ticks)countTimer.current=setTimeout(tick,1000);else resolve()};countTimer.current=setTimeout(tick,1000)});cancelCountdown.current=null
      if(!alive.current)return
      const raw=document.createElement('canvas');raw.width=size.width;raw.height=size.height;drawCamera(raw,video.current);const shot=capturesRef.current.length
      const blob=await new Promise(resolve=>raw.toBlob(resolve,'image/jpeg',0.94));if(!blob)throw new Error('Foto tidak dapat diambil.')
      drawCompanion(raw,overlays.current[Math.min(shot,overlays.current.length-1)],placementRef.current)
      const preview=await new Promise(resolve=>raw.toBlob(resolve,'image/jpeg',0.85));if(!preview)throw new Error('Preview tidak dapat disiapkan.')
      if(alive.current){const next=[...capturesRef.current,{blob,url:urlFor(preview)}];capturesRef.current=next;setCaptures(next)}
    }catch(e){if(alive.current)setError(e.message)}finally{if(alive.current){busyRef.current=false;setBusy(false);setCountdown(null)}}
  }
  const retake=()=>{const previous=capturesRef.current.at(-1);if(previous){URL.revokeObjectURL(previous.url);urls.current.delete(previous.url)}const next=capturesRef.current.slice(0,-1);capturesRef.current=next;setCaptures(next);setError('')}
  const compose=async()=>{
    if(busyRef.current||capturesRef.current.length!==3)return
    busyRef.current=true;setBusy(true);setError('')
    try{const blob=await composeDuetStrip(template.id,capturesRef.current.map(item=>item.blob),placementRef.current);if(alive.current){setResult(urlFor(blob));stream.current?.getTracks().forEach(track=>track.stop())}}catch(e){if(alive.current)setError(e.message)}finally{if(alive.current){busyRef.current=false;setBusy(false)}}
  }
  return <section className="duet-camera">
    <button type="button" onClick={onBack}>← Template Saya</button>
    <h2>{result?'Momen kalian sudah siap.':template.name}</h2>
    {error&&<p role="alert" className="duet-error">{error}</p>}
    {result?<><img className="duet-result" src={result} alt="Photo strip tiga foto bersama teman foto dengan tiga pose berbeda"/><a className="duet-primary" href={result} download="nxduet-photo-strip.png">Unduh photo strip</a></>:<>
      <p>Teman foto berdiri di sisi kiri, jadi berdirilah di sisi kanan. Atur ukurannya sebelum foto pertama. Tiap foto memakai pose berbeda.</p>
      <div className="duet-camera-frame" style={{aspectRatio:`${size.width}/${size.height}`}}><video ref={video} playsInline muted aria-hidden="true"/><canvas ref={canvas} width={size.width} height={size.height} aria-label="Live preview kamera bersama teman foto"/>{countdown&&<strong className="duet-countdown" role="status">{countdown}</strong>}{!ready&&!error&&<p role="status">Membuka kamera…</p>}</div>
      <fieldset disabled={busy||captures.length>0}><legend>Ukuran teman foto</legend><label>Ukuran <input aria-label="Ukuran teman foto" type="range" min="0.4" max="1" step="0.05" value={placement.scale} onChange={e=>setPlacement({...placement,scale:Number(e.target.value)})}/></label></fieldset>
      <p aria-live="polite">{captures.length} dari 3 foto diambil{captures.length<3&&template.poses[captures.length]?` · berikutnya: ${template.poses[captures.length].label}`:''}</p>
      <div className="duet-captures">{captures.map((item,i)=><img key={item.url} src={item.url} alt={`Hasil foto ${i+1}`}/>)}</div>
      <div className="duet-actions"><button className="duet-primary" disabled={!ready||busy||captures.length===3} onClick={snap}>{countdown?`Bersiap… ${countdown}`:`Ambil foto ${Math.min(3,captures.length+1)}`}</button>{captures.length>0&&<button disabled={busy} onClick={retake}>Ulang foto terakhir</button>}{captures.length===3&&<button className="duet-primary" disabled={busy} onClick={compose}>{busy?'Menyusun…':'Susun photo strip'}</button>}</div>
    </>}
  </section>
}

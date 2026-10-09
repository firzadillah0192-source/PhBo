import React, {useEffect,useRef,useState} from 'react'
import {kioskLogout,createGeneration,getGeneration,getResult,resultDownloadUrl,resultImageUrl,startKioskSession,uploadPhoto} from '../../kioskWebApi.js'
import {startGenerationPolling} from '../../generationPolling.js'
import {loadKioskWebCatalog,selectionOptions,readKioskWebJob,saveKioskWebJob,clearKioskWebJob,kioskWebError} from '../../kioskWebFlow.js'
import {openKioskCamera,stopCamera,cameraError,captureCameraPhoto} from '../../kioskCamera.js'
import {CAPTURE_SECONDS,REVIEW_SECONDS,RETAKES_PER_POSE,startKioskCountdown} from '../../kioskCountdown.js'
import KioskResultQr from './KioskResultQr.jsx'
import './kiosk-preview.css'
const modes=[
 {id:'CLASSIC',name:'Classic',tagline:'Pose. Smile. Repeat.',description:'Beberapa pose dalam photo strip dengan frame pilihanmu.',format:'Photo strip',icon:'strip'},
 {id:'BASIC',name:'Basic',tagline:'Your photo, a new look.',description:'Pilih template, ambil satu pose, dan buat hasil personal.',format:'1 foto · template',icon:'portrait'},
 {id:'ADVANCED',name:'Advanced',tagline:'Step into another world.',description:'Pilih pengalaman dan ubah fotomu menjadi dunia baru.',format:'1 foto · pengalaman AI',icon:'world'}]
function ModeArt({type}){return <div className={`kv-art kv-art-${type}`} aria-hidden="true">{type==='strip'?<div className="kv-strips">{[0,1].map(n=><div className="kv-strip" key={n}><i/><i/><i/><small>NXBOOTH</small></div>)}</div>:<div className="kv-portrait"><div className="kv-silhouette"/><div className="kv-orbit"/><span>✦</span></div>}</div>}
export default function KioskPreview(){
 const saved=useRef(readKioskWebJob()).current
 const [mode,setMode]=useState(saved?.mode||'CLASSIC'),[stage,setStage]=useState(saved?'processing':'choose'),[photos,setPhotos]=useState([])
 const [catalog,setCatalog]=useState(null),[catalogBusy,setCatalogBusy]=useState(true),[selection,setSelection]=useState(null),[styleId,setStyleId]=useState('')
 const [operator,setOperator]=useState(false),[modal,setModal]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const [job,setJob]=useState(saved?{job_id:saved.jobId,state:'QUEUED'}:null),[result,setResult]=useState(null),[pollRevision,setPollRevision]=useState(0)
 const urls=useRef(new Set()),video=useRef(null),dialog=useRef(null),operation=useRef(false),mounted=useRef(false)
 const [camera,setCamera]=useState({ready:false,source:'',error:''}),[cameraRevision,setCameraRevision]=useState(0)
 const [captureSeconds,setCaptureSeconds]=useState(CAPTURE_SECONDS),[reviewSeconds,setReviewSeconds]=useState(REVIEW_SECONDS),[retakes,setRetakes]=useState(RETAKES_PER_POSE)
 const reviewDialog=useRef(null),reviewConsumed=useRef(null),actions=useRef({})
 const choice=modes.find(m=>m.id===mode),shots=mode==='CLASSIC'?(selection?.shot_count||0):1
 const current=stage==='choose'?0:stage==='capture'?1:stage==='review'?2:stage==='result'?4:3
 async function reloadCatalog(){setCatalogBusy(true);try{const c=await loadKioskWebCatalog();if(mounted.current){setCatalog(c);if(c.errors)setError('Sebagian katalog belum tersedia. Kamu bisa memuat ulang.')}}catch{if(mounted.current)setError('Katalog belum tersedia.')}finally{if(mounted.current)setCatalogBusy(false)}}
 useEffect(()=>{mounted.current=true;const title=document.title;document.title='NXBooth — Kiosk';reloadCatalog();return()=>{mounted.current=false;document.title=title;for(const url of urls.current)URL.revokeObjectURL(url)}},[])
 useEffect(()=>{
  if(stage!=='capture')return
  let cancelled=false,stream,disconnectTimer
  setCamera({ready:false,source:'',error:''})
  const reconnect=()=>{if(cancelled)return;setCamera(c=>({...c,ready:false}));clearTimeout(disconnectTimer);disconnectTimer=setTimeout(()=>{if(!cancelled)setCameraRevision(n=>n+1)},250)}
  const changed=()=>{if(stream?.getVideoTracks().some(t=>t.readyState==='ended'))reconnect()}
  navigator.mediaDevices?.addEventListener?.('devicechange',changed)
  openKioskCamera().then(active=>{
   if(cancelled){stopCamera(active.stream);return}
   stream=active.stream
   for(const track of stream.getVideoTracks())track.addEventListener('ended',reconnect)
   if(video.current){video.current.srcObject=stream;video.current.play().catch(()=>{})}
   setCamera({ready:false,source:active.source,error:''})
  }).catch(e=>{if(!cancelled)setCamera({ready:false,source:'',error:cameraError(e)})})
  return()=>{cancelled=true;clearTimeout(disconnectTimer);navigator.mediaDevices?.removeEventListener?.('devicechange',changed);for(const track of stream?.getVideoTracks()||[])track.removeEventListener('ended',reconnect);stopCamera(stream)}
 },[stage,cameraRevision])
 useEffect(()=>{
  const popup=reviewDialog.current
  if(stage==='review'&&!popup.open)popup.showModal()
  else if(stage!=='review'&&popup.open)popup.close()
 },[stage])
 useEffect(()=>{
  if(stage!=='capture'||!camera.ready||busy||error)return
  return startKioskCountdown(CAPTURE_SECONDS,{onTick:setCaptureSeconds,onDone:()=>actions.current.takePhoto()})
 },[stage,camera.ready,busy,error,cameraRevision])
 useEffect(()=>{
  if(stage!=='review')return
  return startKioskCountdown(REVIEW_SECONDS,{onTick:setReviewSeconds,onDone:()=>actions.current.nextPose()})
 },[stage,photos.at(-1)?.url])
 useEffect(()=>{if(stage==='ready-process')actions.current.process()},[stage])
 useEffect(()=>{if(modal&&!dialog.current.open)dialog.current.showModal();else if(!modal&&dialog.current.open)dialog.current.close()},[modal])
 useEffect(()=>{
  if(!job?.job_id)return
  let cancelled=false
  const stop=startGenerationPolling({fetchStatus:()=>getGeneration(job.job_id),onStatus:async status=>{
   if(cancelled)return
   setJob(status);setError('')
   if(status.state==='FAILED'){setStage('failed');setError('Proses gagal di backend. Tidak ada hasil yang dibuat.');return}
   if(status.state==='COMPLETED'){
    if(!status.result_id){setStage('failed');setError('Backend belum memberikan hasil foto.');return}
    try{const metadata=await getResult(status.result_id);if(!cancelled){setResult({...metadata,result_id:status.result_id});setStage('result')}}catch(e){if(!cancelled){setStage('failed');setError(kioskWebError(e))}}
   }else if(!['QUEUED','PROCESSING'].includes(status.state)){setStage('failed');setError('Status backend tidak dikenal.')}
  },onError:e=>{if(cancelled)return;setError(kioskWebError(e));if([401,403,404,410].includes(e.status))setStage('failed')}})
  return()=>{cancelled=true;stop()}
 },[job?.job_id,pollRevision])
 function reset(){if(operation.current)return;for(const url of urls.current)URL.revokeObjectURL(url);urls.current.clear();setPhotos([]);setJob(null);setResult(null);clearKioskWebJob();setSelection(null);setRetakes(RETAKES_PER_POSE);setStage('choose');setError('')}
 function openDesign(id){setMode(id);setError('');setModal(true)}
 function selectDesign(item){setSelection(item);const compatible=(catalog?.styles||[]).filter(s=>!item.compatible_frame_style_ids||item.compatible_frame_style_ids.includes(s.id));setStyleId(compatible.find(s=>s.id==='natural')?.id||compatible[0]?.id||'');setModal(false);setRetakes(RETAKES_PER_POSE);setCaptureSeconds(CAPTURE_SECONDS);setStage('capture')}
 async function takePhoto(){
  if(operation.current||photos.length>=shots||!camera.ready)return
  operation.current=true;setBusy(true);setError('')
  try{const file=await captureCameraPhoto(video.current);if(mounted.current){const url=URL.createObjectURL(file);urls.current.add(url);setPhotos(p=>[...p,{url,file}]);setReviewSeconds(REVIEW_SECONDS);setStage('review')}}
  catch(e){if(mounted.current)setError(e.message)}finally{operation.current=false;if(mounted.current)setBusy(false)}
 }
 function consumeReview(){
  const photo=photos.at(-1)
  if(stage!=='review'||operation.current||!photo||reviewConsumed.current===photo.url)return false
  reviewConsumed.current=photo.url;return true
 }
 function nextPose(){
  if(!consumeReview())return
  setError('')
  if(photos.length===shots)setStage('ready-process')
  else{setRetakes(RETAKES_PER_POSE);setCaptureSeconds(CAPTURE_SECONDS);setStage('capture')}
 }
 function retake(){
  if(retakes<=0||!consumeReview())return
  const photo=photos.at(-1);URL.revokeObjectURL(photo.url);urls.current.delete(photo.url)
  setPhotos(p=>p.slice(0,-1));setRetakes(n=>n-1);setCaptureSeconds(CAPTURE_SECONDS);setStage('capture');setError('')
 }
 async function process(){if(operation.current||photos.length!==shots||!selection)return;operation.current=true;setBusy(true);setError('');setStage('uploading')
  try{await startKioskSession();const ids=[];for(const photo of photos){if(!photo.uploadId){const upload=await uploadPhoto(photo.file);photo.uploadId=upload.upload_id}ids.push(photo.uploadId)}const options=selectionOptions(mode,selection,styleId,ids);const created=await createGeneration(ids[0],mode,mode==='BASIC'?selection.id:null,mode==='ADVANCED'?selection.id:null,options);saveKioskWebJob({jobId:created.job_id,mode});if(mounted.current){setJob(created);setStage('processing')}}
  catch(e){if(mounted.current){setError(kioskWebError(e));setStage('submit-error')}}finally{operation.current=false;if(mounted.current)setBusy(false)}
 }
 actions.current={takePhoto,nextPose,process}
 async function fullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen()}catch{setError('Mode layar penuh tidak tersedia di browser ini.')}}
 const styles=(catalog?.styles||[]).filter(s=>!selection?.compatible_frame_style_ids||selection.compatible_frame_style_ids.includes(s.id))
 return <div className="kv-app kv-retro">
  <header className="kv-header"><a className="kv-logo" href="/">NX<span>Booth</span><sup>EVENT STATION</sup></a><div className="kv-header-actions"><span className="kv-preview-dot">Web kiosk</span><button className="kv-icon-button" aria-label="Operator" onClick={()=>setOperator(!operator)}>☷ <span>Operator</span></button></div></header>
  <main className="kv-main"><div className="kv-topline"><span className="kv-eyebrow">YOUR MOMENT STARTS HERE</span><nav aria-label="Tahap sesi" className="kv-steps">{['Desain','Foto','Review','Proses','Hasil'].map((label,i)=><span key={label} className={i===current?'is-current':i<current?'is-done':''} aria-current={i===current?'step':undefined}><b>{i<current?'✓':i+1}</b>{label}</span>)}</nav></div>
   {error&&<div className="kv-error" role="alert">{error}</div>}
   {stage==='choose'?<><div className="kv-intro"><div><h1>A little pose.<br/>A lasting <em>memory.</em></h1><p>Pilih mode dan desainmu. Buat momen ini jadi sesuatu yang bisa dibawa pulang.</p></div><div className="kv-session-note"><span>✦</span><p>One session.<br/><strong>All yours.</strong></p></div></div><div className="kv-mode-grid">{modes.map(item=><button key={item.id} className="kv-mode-card" onClick={()=>openDesign(item.id)}><ModeArt type={item.icon}/><div className="kv-card-body"><div className="kv-card-heading"><h2>{item.name}</h2><span>↗</span></div><span className="kv-tagline">{item.tagline}</span><p>{item.description}</p><div className="kv-card-footer"><span>Pilih desain →</span><span>{item.format}</span></div></div></button>)}</div><div className="kv-bottom-action"><p>Desain terbuka dalam popup di halaman yang sama.</p><span>Foto kamu, cerita kamu. ✦</span></div></>:null}
   {['capture','review'].includes(stage)&&<><div className="kv-stage-heading"><div><span className="kv-mode-label">{choice.name} / {selection?.name} / Pose {Math.min(photos.length+(stage==='capture'?1:0),shots)} dari {shots}</span><h1>{stage==='capture'?'Ready for your close-up?':'Looking good.'}</h1><p>{stage==='capture'?'Lihat kamera. Foto diambil otomatis setelah hitungan mundur.':'Periksa pose terakhir di popup review.'}</p></div><button className="kv-secondary" disabled={busy} onClick={reset}>← Ganti desain</button></div><div className="kv-capture-layout"><div className="kv-camera-area">{stage==='review'?<div className="kv-review-grid">{photos.map((p,i)=><figure key={p.url}><img src={p.url} alt={`Pose ${i+1}`}/><figcaption>POSE {i+1}</figcaption></figure>)}</div>:<div className="kv-live-camera"><video ref={video} autoPlay playsInline muted aria-label="Preview kamera" onLoadedData={()=>setCamera(c=>({...c,ready:true}))} onPlaying={()=>setCamera(c=>({...c,ready:true}))}/>{camera.ready&&!error&&<div className="kv-capture-countdown" role="timer" aria-label="Hitungan mundur foto">{busy?'✦':captureSeconds}</div>}<div className="kv-camera-caption" role="status">{camera.error||(!camera.ready?'Membuka kamera…':busy?'Mengambil foto…':`${camera.source} · Foto otomatis dalam ${captureSeconds} detik`)}</div>{(camera.error||error)&&<button className="kv-secondary" onClick={()=>{setError('');setCameraRevision(n=>n+1)}}>Coba kamera lagi</button>}</div>}</div><aside className="kv-session-sidebar"><span className="kv-eyebrow">SESI KAMU</span><h2>{choice.name}</h2><p>{selection?.name}</p><div className="kv-photo-slots">{Array.from({length:shots},(_,i)=><div key={i}>{photos[i]?<img src={photos[i].url} alt={`Thumbnail pose ${i+1}`}/>:<span>{i+1}</span>}</div>)}</div><p className="kv-photo-count">{photos.length} dari {shots} foto</p>
    {mode==='ADVANCED'&&<label className="kv-style-label">Gaya frame<select value={styleId} onChange={e=>setStyleId(e.target.value)} disabled={busy||stage==='review'}>{styles.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
    <p>Foto otomatis dalam 5 detik. Review setiap pose selama 10 detik. Tiga kesempatan retake per pose.</p>
    <div className="kv-format-note"><span>DESAIN</span><strong>{selection?.name}</strong><small>Printer fisik belum terhubung.</small></div></aside></div></>}
   {stage==='submit-error'&&<section className="kv-process-window"><div className="kv-window-bar">NXBooth / Proses belum terkirim</div><div className="kv-process-body"><h1>Foto belum dapat diproses.</h1><p>Foto sesi tetap tersimpan. Periksa koneksi atau pesan kesalahan, lalu coba lagi.</p><button className="kv-primary" onClick={process} disabled={busy}>Coba proses lagi</button><button className="kv-secondary" onClick={reset}>Sesi baru</button></div></section>}
   {['ready-process','uploading','processing'].includes(stage)&&<section className="kv-process-window" aria-label="Proses foto"><div className="kv-window-bar"><span>NXBooth / Processing</span><span>□</span></div><div className="kv-process-body"><span className="kv-processing-star" aria-hidden="true">✦</span><h1>{stage==='uploading'?'Mengirim foto…':'Sedang membuat hasilmu.'}</h1><p role="status">{stage==='uploading'?'Mengunggah foto ke backend.':job?.state==='PROCESSING'?'PROCESSING — foto sedang diproses.':'QUEUED — pekerjaan menunggu giliran.'}</p><p>Tunggu di halaman ini. Status berasal dari backend.</p></div></section>}
   {stage==='failed'&&<section className="kv-process-window"><div className="kv-window-bar">NXBooth / Status proses</div><div className="kv-process-body"><h1>Proses terhenti.</h1><p>Periksa status pekerjaan yang sama atau mulai sesi baru.</p><button className="kv-secondary" onClick={()=>{setStage('processing');setPollRevision(n=>n+1)}}>Periksa status lagi</button><button className="kv-secondary" onClick={reset}>Sesi baru</button></div></section>}
   {stage==='result'&&result&&<section className="kv-result-window"><div className="kv-window-bar"><span>NXBooth / Your result</span><span>✦</span></div><div className="kv-result-body"><div><span className="kv-eyebrow">HASIL BACKEND</span><h1>Your moment,<br/><em>made yours.</em></h1><p>Hasil fotomu sudah siap.</p><KioskResultQr key={result.result_id} resultId={result.result_id}/><a className="kv-primary" href={resultDownloadUrl(result.result_id)} download>Download foto ↓</a><button className="kv-secondary" onClick={reset}>Sesi baru</button><p>Download menyimpan hasil digital. Cetak fisik belum tersedia.</p></div><img src={resultImageUrl(result.result_id)} alt="Hasil foto dari backend" onError={()=>setError('Hasil belum dapat dimuat. Periksa koneksi atau gunakan download.')}/></div></section>}
   <div className="kv-preview-banner"><span>WEB KIOSK</span><p>Kamera dipilih otomatis: Canon yang tersedia di browser, lalu kamera perangkat. Hasil diproses oleh backend.</p></div>
  </main><footer className="kv-footer"><span>MADE FOR MOMENTS, MADE FOR YOU.</span><span>NXBooth ✦ Event experience</span></footer>
  <dialog className="kv-review-dialog" ref={reviewDialog} onCancel={e=>e.preventDefault()} aria-labelledby="kv-review-title"><div className="kv-window-bar"><span>NXBooth / Review pose {photos.length} dari {shots}</span><span>✦</span></div><div className="kv-pose-review-body"><h2 id="kv-review-title">How does it look?</h2>{stage==='review'&&photos.at(-1)&&<img src={photos.at(-1).url} alt={`Hasil take pose ${photos.length}`}/>}<p>Next otomatis dalam {reviewSeconds} detik.{photos.length===shots?' Setelah ini foto langsung diproses.':' Setelah ini lanjut ke pose berikutnya.'}</p><div className="kv-review-actions"><button className="kv-secondary" disabled={retakes<=0||busy} onClick={retake}>Retake ({retakes})</button><button className="kv-primary" disabled={busy} onClick={nextPose}>Next ({reviewSeconds}) →</button></div></div></dialog>
  <dialog className="kv-design-dialog" ref={dialog} onCancel={e=>{e.preventDefault();setModal(false)}} aria-labelledby="kv-design-title"><div className="kv-window-bar"><span>{choice.name} / Choose your design</span><button aria-label="Tutup pilihan desain" onClick={()=>setModal(false)}>×</button></div><div className="kv-design-body"><span className="kv-eyebrow">PILIH DESAIN</span><h2 id="kv-design-title">Which world is yours?</h2><p>Pilih {mode==='CLASSIC'?'frame':mode==='BASIC'?'template':'pengalaman'} untuk sesi ini.</p>{catalogBusy?<p role="status">Memuat katalog…</p>:<div className="kv-design-grid">{(catalog?.[mode]||[]).map(item=><button key={item.id} onClick={()=>selectDesign(item)}><div className="kv-design-image">{(item.preview_url||item.thumbnail)?<img src={item.preview_url||item.thumbnail} alt="" loading="lazy" onError={e=>{e.currentTarget.style.display='none'}}/>:<span>✦</span>}</div><strong>{item.name}</strong><small>{mode==='CLASSIC'?`${item.shot_count} pose`:'1 pose'}</small></button>)}</div>}{!catalogBusy&&!catalog?.[mode]?.length&&<p role="status">Belum ada desain tersedia untuk mode ini.</p>}<button className="kv-secondary" onClick={reloadCatalog} disabled={catalogBusy}>Muat ulang katalog</button></div></dialog>
  {operator&&<div className="kv-operator" role="dialog" aria-label="Status kiosk"><div><h2>Status kiosk</h2><button aria-label="Tutup panel operator" onClick={()=>setOperator(false)}>×</button></div><dl><dt>Katalog backend</dt><dd>{catalog?'Terhubung':'Belum tersedia'}</dd><dt>Kamera</dt><dd>{camera.source||camera.error||'Belum dibuka'}</dd><dt>Printer</dt><dd>Belum terhubung di web</dd><dt>Status proses</dt><dd>{job?.state||'Belum dimulai'}</dd></dl><button className="kv-secondary" onClick={fullscreen}>Layar penuh</button><button className="kv-secondary" onClick={async()=>{try{await kioskLogout();window.dispatchEvent(new CustomEvent('kiosk:access-lost',{detail:{status:401}}))}catch{setError('Logout gagal. Coba lagi.')}}}>Logout operator</button><button className="kv-secondary" disabled={busy||stage==='processing'} onClick={()=>{reset();setOperator(false)}}>Reset sesi</button></div>}
 </div>
}

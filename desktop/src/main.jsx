import React,{useEffect,useState,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';
import {printerMessage} from '../../frontend/src/kioskPrinter.js';
import {openKioskCamera,stopCamera,captureCameraPhoto,cameraError} from '../../frontend/src/kioskCamera.js';
const names={CLASSIC:'Classic strips',BASIC:'Basic',ADVANCED:'Advanced'};
const messages={BACKEND_NOT_CONFIGURED:'Backend belum dikonfigurasi. Foto tersimpan lokal; generation belum dijalankan.',FIXTURE_REQUIRED:'Operator perlu memilih foto untuk simulasi kamera.',CAMERA_NOT_CONNECTED:'Kamera belum terhubung.',PRINTER_NOT_CONNECTED:'Printer belum terhubung.',OPERATOR_REQUIRED:'Buka panel operator untuk membatalkan sesi ini.',PIN_INVALID:'PIN tidak sesuai.',OPERATOR_PIN_NOT_CONFIGURED:'PIN operator belum dikonfigurasi.',GENERATION_FAILED:'Generation gagal di backend. Tidak ada hasil yang dibuat.',CREDENTIAL_RECOVERY_REQUIRED:'Credential sesi tidak tersedia. Operator perlu memeriksa sesi sebelum mengulang.',PRINT_ALREADY_SUBMITTED:'Pekerjaan cetak sudah tercatat. Periksa jurnal operator.',CATALOG_UNAVAILABLE:'Katalog backend belum dapat dimuat.'};
function App(){
 const [state,setState]=useState(null),[error,setError]=useState(''),[mode,setMode]=useState('CLASSIC'),[choice,setChoice]=useState(''),[panel,setPanel]=useState(false),[operator,setOperator]=useState(false),[pin,setPin]=useState('');
 const [eventName,setEventName]=useState(''),[pairing,setPairing]=useState(null);
 const api=window.nxbooth;
 const video=useRef(null),[camera,setCamera]=useState({ready:false,error:'',source:''});
 const refresh=async()=>{const r=await api.state();if(r.ok)setState(r.data);else setError(r.error.code);};
 useEffect(()=>{if(!api){setError('Jalankan UI melalui aplikasi Electron.');return;}refresh();return api.onChange(refresh);},[]);
 async function act(method,...args){setError('');const r=await api[method](...args);if(!r.ok)setError(messages[r.error.code]||(/^(PRINT|PRINTER)_/.test(r.error.code)?printerMessage(r.error.code):r.error.code));await refresh();}
 const s=state?.session,choices=state?.catalog[mode]||[],personalized=mode==='CLASSIC'&&choices.find(c=>c.id===choice)?.requiresEventName;
 useEffect(()=>{
  if(state?.device.simulated||s?.phase!=='CAPTURING')return;
  let cancelled=false,stream;
  setCamera({ready:false,error:'',source:''});
  openKioskCamera().then(active=>{if(cancelled){stopCamera(active.stream);return;}stream=active.stream;if(video.current){video.current.srcObject=stream;video.current.play().catch(()=>{});}setCamera({ready:false,error:'',source:active.source});}).catch(error=>{if(!cancelled)setCamera({ready:false,error:cameraError(error),source:''});});
  return()=>{cancelled=true;stopCamera(stream);};
 },[s?.phase,state?.device.simulated]);
 async function capture(){
  if(state.device.simulated){await act('capture');return;}
  try{
   const file=await captureCameraPhoto(video.current);
   const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});
   await act('captureWebcam',base64);
  }catch(error){setError(error.message||'Kamera belum siap.');}
 }

 return <main><header><div><strong>NX<span>Booth</span></strong><small>DESKTOP · EVENT STATION</small></div><button className="subtle" onClick={()=>setPanel(!panel)}>Operator</button></header>
  <div className="status"><span className={state?.device.simulated?'badge':'badge neutral'}>{state?.device.simulated?'SIMULASI PERANGKAT':state?.device.printer==='READY'?'PRINTER SIAP · KAMERA VIA WEBCAM':'PERIKSA PERANGKAT'}</span><span>{state?.configured?'Backend dikonfigurasi':'Capture lokal · backend belum dikonfigurasi'}</span></div>
  {error&&<p role="alert" className="alert">{error}</p>}
  {!s?<section><p className="eyebrow">MULAI SESI</p><h1>Abadikan momenmu.</h1><p>Pilih pengalaman foto, lalu lanjutkan ke pengambilan gambar.</p><div className="modes">{Object.entries(names).map(([id,name])=><button key={id} className={mode===id?'card selected':'card'} onClick={()=>{setMode(id);setChoice('');}}><b>{name}</b><span>{id==='CLASSIC'?'Beberapa pose dalam satu layout':'Satu foto untuk hasil personal'}</span></button>)}</div>
  {state?.configured&&<label>Desain <select value={choice} onChange={e=>setChoice(e.target.value)}><option value="">Pilih desain</option>{choices.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
  {state?.connectionError&&<p className="alert">{messages[state.connectionError]}</p>}
  <>{personalized&&<label>Nama event<input value={eventName} maxLength={80} onChange={e=>setEventName(e.target.value)} placeholder="Misalnya: Pernikahan Sarah & Arif" required/><small>Tanggal otomatis mengikuti waktu foto dalam WIB.</small></label>}<button className="primary" disabled={!state||state.busy||state.configured&&!choice||personalized&&(!eventName.trim()||/[\p{Cc}\p{Cf}]/u.test(eventName))} onClick={()=>act('start',mode,choice||undefined,personalized?eventName:undefined)}>Mulai sesi</button></></section>:<section>
  <p className="eyebrow">{names[s.mode]} · {s.captures.length}/{s.shots} FOTO</p>
  <h1>{({CAPTURING:'Siap untuk pose berikutnya?',REVIEWING:'Periksa foto kamu.',UPLOADING:'Mengirim foto…',PROCESSING:'Foto sedang diproses.',RESULT_READY:'Hasil foto kamu.',RECOVERY_REQUIRED:'Sesi perlu diperiksa.',FAILED:'Generation gagal.'})[s.phase]}</h1>
  {s.phase==='CAPTURING'&&!state.device.simulated&&<div className="desktop-camera"><video ref={video} autoPlay muted playsInline aria-label="Preview kamera Canon" onPlaying={()=>setCamera(c=>({...c,ready:true}))}/><p role="status">{camera.error||camera.source||'Membuka kamera…'}</p></div>}<div className="photos">{s.result?<img className="result" src={s.result} alt="Hasil generation dari backend"/>:s.captures.map((c,i)=><figure key={c.id}><img src={c.url} alt={`Foto ${i+1}`}/><figcaption>Foto {i+1}{state.device.simulated?' · simulasi':''}</figcaption></figure>)}</div>
  {s.phase==='CAPTURING'&&<p>{state.device.simulated?'Simulasi mengambil salinan foto pilihan operator.':'Kamera memakai EOS Webcam Utility. Foto diambil dari video kamera.'}</p>}
  {['UPLOADING','PROCESSING'].includes(s.phase)&&<p role="status">{s.jobStatus||'Mengirim foto ke jalur media'} · status berasal dari backend.</p>}
  {s.error&&<p className="alert">{messages[s.error]||s.error}</p>}
  <div className="actions">
  {s.phase==='CAPTURING'&&<button className="primary" disabled={state.busy||!state.device.simulated&&!camera.ready} onClick={capture}>Ambil foto</button>}
  {['CAPTURING','REVIEWING'].includes(s.phase)&&s.captures.length>0&&<button disabled={state.busy} onClick={()=>act('retake')}>Ulangi foto terakhir</button>}
  {s.phase==='REVIEWING'&&<button className="primary" disabled={state.busy} onClick={()=>act('process')}>Proses foto</button>}
  {s.phase==='RESULT_READY'&&<><button className="primary" disabled={state.busy||s.prints.some(p=>p.status!=='REJECTED')} onClick={()=>act('print')}>{state.device.simulated?'Simulasi cetak':'Cetak foto'}</button><button disabled={state.busy} onClick={()=>act('finish')}>Selesai</button></>}
  </div>{s.prints.map(p=><p key={p.id}>{p.status==='SIMULATED'?'Simulasi cetak tercatat. Tidak ada kertas yang dicetak.':p.status==='ACCEPTED'?'Foto sudah dikirim ke printer. Periksa kertas setelah selesai.':`Status cetak: ${p.status}. Periksa sebelum mengulang.`}</p>)}
  </section>}
  {panel&&<aside aria-label="Panel operator"><h2>Panel operator</h2>{!operator?<form onSubmit={async e=>{e.preventDefault();const r=await api.unlock(pin);setPin('');if(r.ok)setOperator(true);else setError(messages[r.error.code]||(/^(PRINT|PRINTER)_/.test(r.error.code)?printerMessage(r.error.code):r.error.code));}}><label>PIN operator <input type="password" autoComplete="off" value={pin} onChange={e=>setPin(e.target.value)}/></label><button>Buka</button></form>:<><p>Kamera: {state?.device.camera} · Printer: {state?.device.printer}</p><p>Credential: {state?.credentialPersistence?'tersimpan terenkripsi':'hanya memori; sesi online tidak dapat dipulihkan setelah restart'}</p>{state?.device.simulated&&<button disabled={state?.busy} onClick={()=>act('chooseFixture')}>Pilih foto simulasi</button>}<button onClick={()=>act('openWebKiosk')}>Buka kiosk di browser</button><button onClick={async()=>{const r=await api.printerPairing();if(r.ok)setPairing(r.data);else setError(r.error.code)}}>Tampilkan kode koneksi browser</button>{pairing&&<label>Kode koneksi printer (tab browser)<input readOnly value={pairing.code} onFocus={e=>e.target.select()}/><small>Salin ke Operator kiosk web. Kode berubah saat aplikasi dimulai ulang. Jangan bagikan.</small></label>}{s&&<><button disabled={state.busy} onClick={()=>act('finish')}>Tutup sesi</button>{['RECOVERY_REQUIRED','FAILED'].includes(s.phase)&&<button disabled={state.busy} onClick={()=>act('process')}>Pulihkan proses sesi</button>}</>}<button onClick={async()=>{await api.lock();setOperator(false);setPairing(null);}}>Kunci panel</button></>}</aside>}
  <footer>Foto tersimpan pada komputer event. Upload dan download foto menggunakan jalur media terpisah.</footer>
 </main>;
}
createRoot(document.getElementById('root')).render(<App/>);

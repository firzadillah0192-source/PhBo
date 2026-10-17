import React,{useEffect,useState,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';
import {printerMessage} from '../../frontend/src/kioskPrinter.js';
import {useSessionCamera,CameraPreview,cameraMessage} from './camera.jsx';
const names={CLASSIC:'Classic Strips',BASIC:'Basic',ADVANCED:'Advanced'};
const messages={BACKEND_NOT_CONFIGURED:'Backend belum dikonfigurasi. Foto tersimpan lokal; generation belum dijalankan.',FIXTURE_REQUIRED:'Operator perlu memilih foto untuk simulasi kamera.',CAMERA_NOT_CONNECTED:'Kamera belum terhubung.',PRINTER_NOT_CONNECTED:'Printer belum terhubung.',OPERATOR_REQUIRED:'Buka panel operator untuk membatalkan sesi ini.',PIN_INVALID:'PIN tidak sesuai.',OPERATOR_PIN_NOT_CONFIGURED:'PIN operator belum dikonfigurasi.',GENERATION_FAILED:'Generation gagal di backend. Tidak ada hasil yang dibuat.',CREDENTIAL_RECOVERY_REQUIRED:'Credential sesi tidak tersedia. Operator perlu memeriksa sesi sebelum mengulang.',PRINT_ALREADY_SUBMITTED:'Pekerjaan cetak sudah tercatat. Periksa jurnal operator.',CATALOG_UNAVAILABLE:'Katalog desain belum dapat dimuat. Periksa koneksi internet, lalu tekan Cek ulang.',SELECTION_REQUIRED:'Pilih desain terlebih dahulu.',EVENT_NAME_REQUIRED:'Isi nama event terlebih dahulu.',OPERATOR_LOCKED:'Terlalu banyak percobaan. Coba lagi sebentar lagi.',SETUP_DONE:'Pengaturan awal sudah selesai.',KEY_FROM_ENVIRONMENT:'Kunci kiosk diatur lewat environment dan tidak bisa diubah di sini.',UPDATE_ONLY_PACKAGED:'Update hanya tersedia pada aplikasi terpasang.',UPDATE_SESSION_ACTIVE:'Selesaikan atau tutup sesi foto dulu sebelum update.',UPDATE_SIGNER_NOT_CONFIGURED:'Pengaturan penanda tangan update tidak valid. Pasang ulang dari installer resmi.',UPDATE_SIGNATURE_INVALID:'Tanda tangan installer tidak cocok atau belum dipercaya di PC ini. Update dibatalkan.',UPDATE_HASH_MISMATCH:'File update rusak (hash tidak cocok). Update dibatalkan.',UPDATE_SIZE_MISMATCH:'Ukuran file update tidak sesuai. Update dibatalkan.',UPDATE_DOWNLOAD_FAILED:'Gagal mengunduh update. Periksa koneksi lalu coba lagi.',UPDATE_NOT_AVAILABLE:'Tidak ada update baru.',UPDATE_MANIFEST_INVALID:'Data update di server tidak valid.',UPDATE_UNAVAILABLE:'Server update belum siap.',UNAUTHORIZED:'Akun ini tidak lagi diizinkan memakai kiosk, atau sesi masuk berakhir. Buka Menu staf lalu Keluar dan Masuk lagi.',PIN_REQUIRED:'Masukkan PIN staf.',DEVICE_CODE_EXPIRED:'Kode kedaluwarsa. Buat kode baru.',DEVICE_CODES_BUSY:'Server sedang sibuk. Coba lagi sebentar lagi.',LOGIN_FAILED:'Tidak bisa menghubungi server. Periksa internet lalu coba lagi.',LOGIN_SAVE_FAILED:'Persetujuan diterima tetapi tidak dapat disimpan. Coba lagi.',BACKEND_REQUEST_FAILED:'Server tidak menjawab dengan benar.',ADAPTER_TIMEOUT:'Verifikasi update terlalu lama. Coba lagi.',PRINTER_NOT_CONNECTED:'Printer belum tersambung. Sambungkan printer lalu tekan Cetak foto lagi, atau pilih Selesai tanpa cetak.',PRINTER_UNAVAILABLE:'Printer tidak bisa dipakai. Periksa kabel, daya, dan layanan cetak Windows, lalu coba lagi atau pilih Selesai tanpa cetak.',PROBE_SESSION_ACTIVE:'Tutup sesi foto dulu sebelum tes kamera.',CAMERA_WINDOWS_ONLY:'Tes kamera Canon hanya berjalan di Windows.',CAMERA_BUSY:'Tes kamera sedang berjalan.',INVALID_DIAGNOSTICS:'Laporan ditolak server.',DIAGNOSTICS_FULL:'Batas laporan hari ini tercapai. Coba lagi besok.'};
const modes=[
 {id:'CLASSIC',name:'Classic Strips',tag:'Strip foto event',desc:'Beberapa pose disusun dalam satu strip dengan frame pilihan. Tanpa AI.',color:'classic'},
 {id:'BASIC',name:'Basic',tag:'Potret bertema',desc:'Satu foto diubah menjadi potret bertema siap pakai.',color:'basic'},
 {id:'ADVANCED',name:'Advanced',tag:'Gaya kreatif',desc:'Satu foto diubah dengan gaya kreatif pilihan, seperti 3D atau 8-bit.',color:'advanced'}];
const steps=['Mode','Desain','Foto','Proses','Hasil'];
const canonLike=label=>/canon|eos/i.test(label||'');
async function detectCameras(device,backend){
 if(device?.simulated)return {list:['Kamera simulasi (foto dipilih staf)'],note:''};
 if(backend==='canon-sdk')return {list:device?.camera==='CANON_SDK'?['Canon USB']:[],note:'Hubungkan kamera Canon lewat USB, nyalakan, dan tutup aplikasi kamera lain.'};
 const media=navigator.mediaDevices;
 try{return {list:(await media.enumerateDevices()).filter(d=>d.kind==='videoinput').map(d=>d.label||'Kamera'),note:''};}
 catch{return {list:[],note:'Kamera belum terhubung.'};}
}
function Thumb({mode,id,name,api}){
 const ref=useRef(null),[src,setSrc]=useState('');
 useEffect(()=>{
  let cancelled=false;const el=ref.current;
  const load=()=>api.thumbnail(mode,id).then(r=>{if(!cancelled&&r.ok)setSrc(r.data);});
  if(!el||typeof IntersectionObserver==='undefined'){load();return()=>{cancelled=true;};}
  const io=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){io.disconnect();load();}},{rootMargin:'200px'});io.observe(el);
  return()=>{cancelled=true;io.disconnect();};
 },[mode,id]);
 return <div className="thumb" ref={ref}>{src?<img src={src} alt={name}/>:<span className="thumb-wait" aria-hidden="true"/>}</div>;
}
function Row({ok,label,value,hint}){return <li className={`check ${ok===true?'ok':ok===false?'warn':'info'}`}><i aria-hidden="true">{ok===true?'✓':ok===false?'!':'i'}</i><div><b>{label}</b><span>{value}</span>{hint&&<small className="hint">{hint}</small>}</div></li>;}
function App(){
 const [state,setState]=useState(null),[error,setError]=useState(''),[mode,setMode]=useState('CLASSIC'),[choice,setChoice]=useState(''),[panel,setPanel]=useState(false),[operator,setOperator]=useState(false),[pin,setPin]=useState('');
 const [newPin,setNewPin]=useState(''),[newPin2,setNewPin2]=useState(''),[keyInput,setKeyInput]=useState(''),[upd,setUpd]=useState(null),[updBusy,setUpdBusy]=useState(false);
 const [probe,setProbe]=useState(null),[probeBusy,setProbeBusy]=useState(false),[diag,setDiag]=useState('');
 const [eventName,setEventName]=useState(''),[pairing,setPairing]=useState(null),[view,setView]=useState('check'),[cams,setCams]=useState(null),[checking,setChecking]=useState(false),[count,setCount]=useState(0);
 const api=window.nxbooth;
 const latestRefresh=useRef(0);
 const refresh=async()=>{const n=++latestRefresh.current;const r=await api.state();if(n===latestRefresh.current){if(r.ok)setState(r.data);else setError(r.error.code);}return r.ok?r.data:null;};
 async function runCheck(){
  setChecking(true);setError('');
  const r=await api.refresh();const st=r.ok?r.data:await refresh();if(r.ok)setState(r.data);
  setCams(await detectCameras(st?.device,st?.cameraBackend));setChecking(false);
 }
 useEffect(()=>{if(!api){setError('Jalankan UI melalui aplikasi Electron.');return;}
  refresh().then(st=>{if(st&&!st.session)runCheck();else if(st)setCams({list:[],note:''});});return api.onChange(refresh);},[]);
 async function act(method,...args){setError('');const r=await api[method](...args);if(!r.ok)setError(messages[r.error.code]||(/^(PRINT|PRINTER)_/.test(r.error.code)?printerMessage(r.error.code):r.error.code));await refresh();return r.ok;}
 const s=state?.session,choices=state?.catalog[mode]||[],picked=choices.find(c=>c.id===choice),personalized=mode==='CLASSIC'&&picked?.requiresEventName;
 const camera=useSessionCamera(api,{active:s?.phase==='CAPTURING',simulated:!!state?.device.simulated,backend:state?.cameraBackend});
 async function capture(){
  setError('');
  try{const r=await camera.capture();if(!r.ok)setError(r.error.code.startsWith('CAMERA_')?cameraMessage(r.error.code):messages[r.error.code]||r.error.code);await refresh();}
  catch(error){setError(error.message||'Kamera belum siap.');}
 }
 async function countdownThenCapture(){
  for(let n=3;n>=1;n--){setCount(n);await new Promise(r=>setTimeout(r,1000));}
  setCount(0);await capture();
 }
 async function startSession(){
  const ok=await act('start',mode,choice||undefined,personalized?eventName:undefined);
  if(ok){setChoice('');setEventName('');}
 }
 function backHome(){setChoice('');setEventName('');setView('mode');}
 const fail=r=>setError(messages[r.error.code]||(/^(PRINT|PRINTER)_/.test(r.error.code)?printerMessage(r.error.code):r.error.code));
 async function savePin(e){
  e.preventDefault();setError('');
  if(newPin.length<4){setError('PIN minimal 4 karakter.');return;}
  if(newPin!==newPin2){setError('Konfirmasi PIN tidak sama.');return;}
  const r=await api.pinCreate(newPin);setNewPin('');setNewPin2('');
  if(r.ok)await refresh();else fail(r);
 }
 useEffect(()=>{if(state?.loginRequired&&state.login.status==='idle')api.loginStart().then(refresh);},[state?.loginRequired,state?.login?.status]);
 async function checkUpdate(){setUpdBusy(true);setError('');const r=await api.updateCheck();setUpdBusy(false);if(r.ok)setUpd(r.data);else fail(r);}
 async function runProbe(){setProbeBusy(true);setError('');setDiag('');const r=await api.cameraProbe();setProbeBusy(false);if(r.ok)setProbe(r.data);else fail(r);}
 async function sendDiagnostics(){setProbeBusy(true);setError('');setDiag('');const r=await api.diagnosticsSend();setProbeBusy(false);if(r.ok)setDiag(`Terkirim (kode ${r.data.id}).`);else fail(r);}
 async function installUpdate(){setUpdBusy(true);setError('');const r=await api.updateInstall();if(r.ok)setUpd({installing:true});else{setUpdBusy(false);fail(r);}}
 const phase=s?.phase;
 const step=s?(['CAPTURING','REVIEWING'].includes(phase)?3:['UPLOADING','PROCESSING'].includes(phase)?4:phase==='RESULT_READY'?5:3):view==='style'?2:view==='mode'?1:0;
 const accent={CLASSIC:'classic',BASIC:'basic',ADVANCED:'advanced'};
 const title=({CAPTURING:'Siap untuk pose berikutnya?',REVIEWING:'Periksa foto kamu.',UPLOADING:'Mengirim foto…',PROCESSING:'Foto sedang diproses.',RESULT_READY:'Hasil foto kamu.',RECOVERY_REQUIRED:'Sesi perlu diperiksa.',FAILED:'Generation gagal.'})[phase];
 const dev=state?.device,printerOk=dev&&(dev.simulated||dev.printer==='READY');
 const needsName=personalized&&(!eventName.trim()||/[\p{Cc}\p{Cf}]/u.test(eventName));
 const catalogEmpty=!choices.length;
 const loginView=state?.login;
 if(state?.loginRequired)return <main className="stage"><section className="screen" aria-label="Masuk"><p className="eyebrow">MASUK</p><h1>Masuk ke NXBooth</h1>
  <p className="lead">Komputer ini perlu diizinkan oleh staf. Admin mengatur siapa yang boleh memakai kiosk.</p>
  {error&&<p role="alert" className="alert">{error}</p>}
  {loginView?.status==='pending'?<div className="login-code"><p className="lead">1. Buka <b>{loginView.url}</b> di HP atau komputer lain.<br/>2. Masuk dengan akun staf.<br/>3. Masukkan kode ini:</p><div className="code" aria-label="Kode aktivasi">{loginView.userCode}</div><p role="status" className="lead row"><span className="spinner"/>Menunggu persetujuan…</p></div>
   :loginView?.status==='approved'?<p role="status" className="lead">Berhasil masuk…</p>
   :<p className="lead">{loginView?.status==='expired'?'Kode kedaluwarsa. ':loginView?.status==='error'?(messages[loginView.error]||'Tidak bisa menghubungi server. '):'Membuat kode…'}</p>}
  <div className="actions"><button className="primary" disabled={loginView?.status==='pending'} onClick={()=>act('loginStart')}>{loginView?.status==='pending'?'Menunggu…':'Buat kode baru'}</button><button onClick={()=>act('loginSkip')}>Lanjut tanpa masuk (hanya ambil foto)</button></div></section></main>;
 if(state?.pinPrompt)return <main className="stage"><section className="screen" aria-label="PIN kunci layar"><p className="eyebrow">KUNCI MENU STAF</p><h1>Buat PIN kunci layar</h1>
  <p className="lead">Masuk sebagai {state.staff?.name||state.staff?.email||'staf'}. PIN ini hanya mencegah tamu membuka Menu staf; identitas Anda tetap akun. Boleh dilewati.</p>
  {error&&<p role="alert" className="alert">{error}</p>}
  <form onSubmit={savePin}><label className="field">PIN (minimal 4 karakter)<input type="password" autoComplete="off" value={newPin} onChange={e=>setNewPin(e.target.value)}/></label><label className="field">Ulangi PIN<input type="password" autoComplete="off" value={newPin2} onChange={e=>setNewPin2(e.target.value)}/></label>
  <div className="actions"><button className="primary">Simpan PIN</button><button type="button" onClick={()=>act('pinSkip')}>Lewati</button></div></form></section></main>;
 return <main className="stage"><header className="bar"><div className="brand"><strong>NX<span>Booth</span></strong><small>DESKTOP · EVENT STATION</small></div>
  <ol className="steps" aria-label="Langkah sesi">{steps.map((n,i)=><li key={n} className={i+1<step?'done':i+1===step?'current':''} aria-current={i+1===step?'step':undefined}><i>{i+1<step?'✓':i+1}</i>{n}</li>)}</ol>
  <button className="subtle" onClick={()=>setPanel(!panel)} aria-expanded={panel}>Menu staf</button></header>
  {error&&<p role="alert" className="alert">{error}</p>}
  {!s&&view==='check'&&<section className="screen" aria-label="Cek perangkat"><p className="eyebrow">PERSIAPAN</p><h1>Cek perangkat</h1><p className="lead">Pemeriksaan singkat sebelum mulai. Tidak ada yang wajib: jika perangkat belum terhubung, Anda tetap bisa lanjut dan aplikasi memakai perangkat yang terdeteksi nanti.</p>
   <ul className="checks" aria-live="polite">
    <Row ok={checking||!cams?null:cams.list.length>0} label="Kamera" value={checking||!cams?'Memeriksa…':cams.list.length?`${cams.list.length>1?cams.list.length+' kamera: ':''}${(cams.list.find(canonLike)||cams.list[0])} ${canonLike(cams.list.find(canonLike)||'')?'· Canon terdeteksi':''}`:'Tidak ada kamera terdeteksi'} hint={!cams||checking?'':cams.list.length?'':(cams.note||'Hubungkan kamera Canon lewat USB.')}/>
    <Row ok={checking||!dev?null:!!printerOk} label="Printer" value={checking||!dev?'Memeriksa…':printerOk?(dev.simulated?'Simulasi (tidak mencetak)':dev.printerName||'Siap'):'Printer belum terdeteksi'} hint={checking||!dev||printerOk?'':'Pasang driver printer dan nyalakan. Aplikasi memakai printer yang terdeteksi saat mencetak.'}/>
    <Row ok={checking||!state?null:state.catalogLoaded?true:false} label="Server NXBooth" value={checking||!state?'Memeriksa…':state.catalogLoaded?`Terhubung · ${state.catalog.CLASSIC.length} frame, ${state.catalog.BASIC.length} tema, ${state.catalog.ADVANCED.length} gaya`:'Katalog belum bisa dimuat'} hint={checking||!state?'':state.connectionError?messages[state.connectionError]:''}/>
    <Row ok={null} label="Pemrosesan foto" value={state?.configured?'Tersambung ke server':'Belum login'} hint={state?.configured?'':'Foto bisa diambil dan ditinjau. Login Google staf untuk pemrosesan sedang disiapkan.'}/>
   </ul>
   <div className="actions"><button className="primary" onClick={()=>setView('mode')}>Lanjutkan</button><button disabled={checking} onClick={runCheck}>{checking?'Memeriksa…':'Cek ulang'}</button></div></section>}
  {!s&&view==='mode'&&<section className="screen"><p className="eyebrow">LANGKAH 1 · PILIH MODE</p><h1>Abadikan momenmu.</h1><p className="lead">Pilih pengalaman foto yang kamu mau.</p>
   <div className="modes">{modes.map(m=><button key={m.id} className={`card ${m.color}`} onClick={()=>{setMode(m.id);setChoice('');setEventName('');setError('');setView('style');}}><span className="dot"/><b>{m.name}</b><span className="tag">{m.tag}</span><span className="sub">{m.desc}</span></button>)}</div>
   <div className="actions"><button onClick={()=>setView('check')}>Cek perangkat</button></div></section>}
  {!s&&view==='style'&&<section className="screen"><p className="eyebrow">LANGKAH 2 · {names[mode].toUpperCase()}</p><h1>{mode==='CLASSIC'?'Pilih frame':mode==='BASIC'?'Pilih tema':'Pilih gaya'}</h1>
   {catalogEmpty?<p className="lead">{state?.catalogLoaded||state?.configured?'Belum ada desain untuk mode ini.':'Katalog desain belum tersedia, jadi sesi dimulai tanpa desain (hanya ambil dan tinjau foto).'}</p>
   :<div className="gallery" role="radiogroup" aria-label="Pilihan desain">{choices.map(c=><button key={c.id} role="radio" aria-checked={choice===c.id} className={`tile${choice===c.id?' selected':''}`} onClick={()=>setChoice(c.id)}><Thumb api={api} mode={mode} id={c.id} name={c.name}/><b>{c.name}</b><span>{mode==='CLASSIC'?`${c.shots} foto`:c.theme}</span></button>)}</div>}
   {personalized&&<label className="field">Nama event<input value={eventName} maxLength={80} onChange={e=>setEventName(e.target.value)} placeholder="Misalnya: Pernikahan Sarah & Arif" required/><small>Tanggal otomatis mengikuti waktu foto dalam WIB.</small></label>}
   <div className="actions"><button className="primary" disabled={!state||state.busy||!catalogEmpty&&!choice||needsName} onClick={startSession}>Mulai sesi</button><button onClick={backHome}>Kembali</button></div></section>}
  {s&&<section className="screen">
  <p className="eyebrow">{names[s.mode]} · {s.captures.length}/{s.shots} FOTO</p>
  <h1>{title}</h1>
  {phase==='CAPTURING'&&!state.device.simulated&&<div className="desktop-camera"><CameraPreview camera={camera}/>{count>0&&<div className="count" role="status" aria-label={`Hitung mundur ${count}`}>{count}</div>}<p role="status">{camera.error||camera.source||'Membuka kamera…'}</p></div>}<div className="photos">{s.result?<img className="result" src={s.result} alt="Hasil generation dari backend"/>:s.captures.map((c,i)=><figure key={c.id}><img src={c.url} alt={`Foto ${i+1}`}/><figcaption>Foto {i+1}{state.device.simulated?' · simulasi':''}</figcaption></figure>)}</div>
  {phase==='CAPTURING'&&<p className="lead">{state.device.simulated?'Simulasi mengambil salinan foto pilihan staf.':'Tekan Ambil foto. Ada hitung mundur 3 detik; foto diambil dari kamera Canon melalui USB.'}</p>}
  {['UPLOADING','PROCESSING'].includes(phase)&&<p role="status" className="lead row"><span className="spinner"/>{s.jobStatus||'Mengirim foto ke jalur media'} · status berasal dari backend.</p>}
  {s.error&&<p className="alert">{messages[s.error]||s.error}</p>}
  <div className="actions">
  {phase==='CAPTURING'&&camera.sdk&&camera.error&&<button onClick={camera.reconnect}>Sambungkan ulang kamera</button>}
  {phase==='CAPTURING'&&<button className="primary" disabled={state.busy||count>0||!state.device.simulated&&!camera.ready} onClick={state.device.simulated?capture:countdownThenCapture}>Ambil foto</button>}
  {['CAPTURING','REVIEWING'].includes(phase)&&s.captures.length>0&&<button disabled={state.busy||count>0} onClick={()=>act('retake')}>Ulangi foto terakhir</button>}
  {phase==='REVIEWING'&&<button className="primary" disabled={state.busy} onClick={()=>act('process')}>Proses foto</button>}
  {phase==='RESULT_READY'&&<><button className="primary" disabled={state.busy||s.prints.some(p=>p.status!=='REJECTED')} onClick={()=>act('print')}>{state.device.simulated?'Simulasi cetak':'Cetak foto'}</button><button disabled={state.busy} onClick={async()=>{if(await act('finish'))setView('mode');}}>{s.prints.some(p=>['ACCEPTED','SIMULATED'].includes(p.status))?'Selesai':'Selesai tanpa cetak'}</button></>}
  </div>{s.prints.map(p=><p key={p.id} className="lead">{p.status==='SIMULATED'?'Simulasi cetak tercatat. Tidak ada kertas yang dicetak.':p.status==='ACCEPTED'?'Foto sudah dikirim ke printer. Periksa kertas setelah selesai.':p.status==='REJECTED'?'Belum dicetak: printer belum menerima pekerjaan. Sambungkan printer lalu tekan Cetak foto lagi, atau pilih Selesai tanpa cetak.':`Status cetak: ${p.status}. Periksa sebelum mengulang.`}</p>)}
  </section>}
  {panel&&<aside aria-label="Menu staf"><div className="drawer-head"><h2>Menu staf</h2><button className="subtle" onClick={()=>setPanel(false)}>Tutup menu</button></div>
   <p className="lead">Area khusus petugas event, bukan untuk tamu. Di sini staf bisa memeriksa perangkat, menutup atau memulihkan sesi yang macet, memilih foto simulasi, dan menyambungkan printer ke kiosk di browser. Dikunci dengan PIN staf jika sudah dibuat.</p>
   {!operator&&!state?.pinSet?<div className="actions"><button onClick={async()=>{const r=await api.openStaff();if(r.ok)setOperator(true);else fail(r);}}>Buka menu staf</button>{!state?.configured&&<button onClick={()=>{setPanel(false);act('loginShow');}}>Masuk akun</button>}</div>:!operator?<form onSubmit={async e=>{e.preventDefault();const r=await api.unlock(pin);setPin('');if(r.ok)setOperator(true);else setError(messages[r.error.code]||(/^(PRINT|PRINTER)_/.test(r.error.code)?printerMessage(r.error.code):r.error.code));}}><label>PIN staf <input type="password" autoComplete="off" value={pin} onChange={e=>setPin(e.target.value)}/></label><button>Buka</button></form>:<>
   <p>Kamera: {state?.device.camera} · Printer: {state?.device.printer}{state?.device.printerName?` (${state.device.printerName})`:''}</p>
   <p>Credential: {state?.credentialPersistence?'tersimpan terenkripsi':'hanya memori; sesi online tidak dapat dipulihkan setelah restart'}</p>
   <h3>Versi dan update</h3>
   <p>Versi terpasang: {state?.version||'-'}</p>
   <div className="actions"><button disabled={updBusy||!state?.configured} onClick={checkUpdate}>Cek update</button>
   {upd?.available&&<button className="primary" disabled={updBusy||!!s} onClick={installUpdate}>Pasang versi {upd.version}</button>}</div>
   {!state?.configured&&<small className="hint">Masuk akun dulu untuk memakai update.</small>}
   {upd&&!upd.available&&!upd.installing&&<p role="status">Sudah versi terbaru.</p>}
   {upd?.available&&<p role="status">Tersedia versi {upd.version}{upd.notes?` · ${upd.notes}`:''}. {s?'Tutup sesi foto dulu.':'Aplikasi akan menutup dan memasang update.'}</p>}
   {upd?.installing&&<p role="status">Memasang update… aplikasi akan terbuka kembali.</p>}
   <h3>Kamera Canon dan log</h3>
   <p>Tes membaca kamera lewat USB (tanpa EOS Utility): live view, lalu satu foto uji yang langsung dihapus. Kamera ON, mode foto, tutup EOS Utility/Zoom.</p>
   <div className="actions"><button disabled={probeBusy||!!s} onClick={runProbe}>{probeBusy?'Menguji…':'Tes kamera Canon'}</button>
   <button disabled={probeBusy||!state?.configured} onClick={sendDiagnostics}>Kirim log ke server</button></div>
   {!state?.configured&&<small className="hint">Masuk akun dulu untuk mengirim log.</small>}
   {probe&&<div role="status"><p><b>{probe.ok?'Kamera berfungsi':'Tes kamera gagal'}</b>{probe.model?` · ${probe.model}`:''}{probe.cameras.length?'':' · tidak ada kamera terdeteksi'} · {probe.total_ms} ms</p>
    <ul>{probe.steps.map((st,i)=><li key={i}>{st.ok?'OK':'GAGAL'} · {st.name} · {st.ms} ms{st.code?` · ${st.code}`:''}{st.detail?` · ${st.detail}`:''}{st.size_bytes?` · ${st.size_bytes} byte`:''}</li>)}</ul></div>}
   {diag&&<p role="status">{diag}</p>}
   <h3>Akun</h3>
   <p>{state?.staff?`Masuk sebagai ${state.staff.name||state.staff.email}`:state?.configured?(state.keyFromEnvironment?'Memakai kunci kiosk dari environment':'Memakai kunci kiosk lama (bukan per akun)'):'Belum masuk'}</p>
   <div className="actions">{state?.configured&&!state.keyFromEnvironment&&<button onClick={async()=>{const r=await api.logout();if(r.ok){setOperator(false);setPanel(false);await refresh();}else fail(r);}}>Keluar</button>}{!state?.configured&&<button onClick={()=>{setPanel(false);act('loginShow');}}>Masuk akun</button>}</div>
   {!state?.configured&&<form onSubmit={async e=>{e.preventDefault();const r=await api.setApiKey(keyInput.trim());setKeyInput('');if(r.ok)await refresh();else fail(r);}}><label>Kunci kiosk lama (opsional) <input type="password" autoComplete="off" minLength={32} value={keyInput} onChange={e=>setKeyInput(e.target.value)}/></label><button disabled={keyInput.trim().length<32}>Simpan kunci</button></form>}
   <h3>PIN kunci layar</h3>
   <form onSubmit={savePin}><label>{state?.pinSet?'PIN baru':'Buat PIN'} <input type="password" autoComplete="off" value={newPin} onChange={e=>setNewPin(e.target.value)}/></label><label>Ulangi PIN <input type="password" autoComplete="off" value={newPin2} onChange={e=>setNewPin2(e.target.value)}/></label><button disabled={newPin.length<4}>Simpan PIN</button></form>
   <h3>Perangkat dan sesi</h3>
   <div className="actions">
   <button disabled={checking} onClick={async()=>{if(s)return;setView('check');setPanel(false);runCheck();}}>Cek perangkat lagi</button>
   {state?.device.simulated&&<button disabled={state?.busy} onClick={()=>act('chooseFixture')}>Pilih foto simulasi</button>}
   <button onClick={()=>act('openWebKiosk')}>Buka kiosk di browser</button>
   <button onClick={async()=>{const r=await api.printerPairing();if(r.ok)setPairing(r.data);else setError(r.error.code)}}>Tampilkan kode koneksi browser</button>
   {s&&<><button disabled={state.busy} onClick={async()=>{if(await act('finish'))setView('mode');}}>Tutup sesi</button>{['RECOVERY_REQUIRED','FAILED'].includes(s.phase)&&<button disabled={state.busy} onClick={()=>act('process')}>Pulihkan proses sesi</button>}</>}
   <button onClick={async()=>{await api.lock();setOperator(false);setPairing(null);}}>Kunci panel</button></div>
   {pairing&&<label>Kode koneksi printer (tab browser)<input readOnly value={pairing.code} onFocus={e=>e.target.select()}/><small>Salin ke bagian Operator di kiosk web. Kode berubah saat aplikasi dimulai ulang. Jangan bagikan.</small></label>}
   </>}</aside>}
  <footer>Foto tersimpan pada komputer event. Upload dan download foto menggunakan jalur media terpisah.</footer>
 </main>;
}
createRoot(document.getElementById('root')).render(<App/>);

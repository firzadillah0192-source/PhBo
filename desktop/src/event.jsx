import React,{useEffect,useRef,useState} from 'react';
import {QRCodeSVG} from 'qrcode.react';
import {printerMessage} from '../../frontend/src/kioskPrinter.js';
import {useSessionCamera,CameraPreview,cameraMessage} from './camera.jsx';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const OUT_OF_REACH=/^(PRINTER_(NOT_CONNECTED|UNAVAILABLE|SELECTION_REQUIRED|MODEL_UNSUPPORTED|APP_.+)|ADAPTER_UNAVAILABLE)$/;
export function printNotice(code){
  if(OUT_OF_REACH.test(code))return 'Printer di luar jangkauan. Foto tidak dicetak.';
  return /^(PRINT|PRINTER)_/.test(code)?printerMessage(code):'Foto belum bisa dicetak.';
}
export const eventDate=date=>{try{return new Date(date+'T00:00:00').toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'});}catch{return date;}};
const names={CLASSIC:'Classic',BASIC:'Basic',ADVANCED:'Advanced'};

/** Guest-facing event station: Start -> automatic shots (countdown, short retake window) -> automatic processing -> automatic print -> QR. */
export function EventKiosk({api,state,event,refresh,setError,fail,Thumb}){
  const T=event.timing,s=state.session,phase=s?.phase,simulated=!!state.device.simulated;
  const available=event.templates.map(t=>({...t,item:state.catalog[t.mode]?.find(x=>x.id===t.id)})).filter(t=>t.item);
  const missing=event.templates.length-available.length;
  const [stage,setStage]=useState('welcome'),[ui,setUi]=useState('count'),[count,setCount]=useState(0),[holdLeft,setHoldLeft]=useState(0);
  const [qr,setQr]=useState(null),[qrError,setQrError]=useState(''),[printNote,setPrintNote]=useState({text:'',failed:false}),[resetLeft,setResetLeft]=useState(0),[busy,setBusy]=useState(false);
  const loop=useRef(null),camReady=useRef(false),retakeReq=useRef(false),handled=useRef(null);
  useEffect(()=>()=>{loop.current=null;},[]);
  const cam=useSessionCamera(api,{active:phase==='CAPTURING',simulated,backend:state.cameraBackend});
  camReady.current=cam.ready||simulated;
  async function shoot(){
    try{const r=await cam.capture();await refresh();if(!r.ok){setError(r.error.code.startsWith('CAMERA_')?cameraMessage(r.error.code):r.error.code);return false;}return true;}
    catch(error){setError(error.message||'Kamera belum siap.');return false;}
  }
  async function waitForCamera(alive){
    for(let i=0;i<600&&alive();i++){if(camReady.current)return true;await sleep(100);}
    return false;
  }
  // One loop per session: countdown, shoot, retake window, repeat; then process. Re-reads state from the backend after every step.
  async function run(sid){
    const alive=()=>loop.current===sid;
    try{
      while(alive()){
        const st=(await refresh())?.session;
        if(!st||st.id!==sid)return;
        if(st.phase==='REVIEWING'){
          setUi('process');
          const r=await api.process();await refresh();if(!r.ok)fail(r);return;
        }
        if(st.phase!=='CAPTURING')return;
        await sleep(250); // let the camera effect reset after a phase change before trusting 'ready'
        if(!await waitForCamera(alive)){if(alive()){setError('Kamera belum siap. Periksa kamera, lalu tekan Batal.');setUi('error');}return;}
        setUi('count');
        for(let n=T.countdown;n>=1&&alive();n--){setCount(n);await sleep(1000);}
        setCount(0);
        if(!alive())return;
        if(!await shoot()){setUi('error');return;}
        setUi('hold');retakeReq.current=false;
        for(let left=T.retake*10;left>0&&alive()&&!retakeReq.current;left--){setHoldLeft(Math.ceil(left/10));await sleep(100);}
        if(!alive())return;
        if(retakeReq.current){retakeReq.current=false;await api.retake();}
      }
    }catch{setError('Terjadi kendala. Tekan Mulai ulang.');}
  }
  useEffect(()=>{
    if(!s||phase!=='CAPTURING'||loop.current===s.id)return;
    loop.current=s.id;run(s.id);
  },[s?.id,phase]);

  // Result: print automatically and prepare the download QR once per session.
  useEffect(()=>{
    if(phase!=='RESULT_READY'||handled.current===s.id)return;
    handled.current=s.id;setQr(null);setQrError('');setPrintNote({text:'Mencetak…',failed:false});setResetLeft(T.reset);
    api.resultClaim().then(r=>{if(r.ok)setQr(r.data);else setQrError('QR belum bisa dibuat. Tekan Mulai ulang lalu coba lagi.');});
    print();
  },[phase,s?.id]);
  useEffect(()=>{
    if(phase!=='RESULT_READY'||resetLeft<=0)return;
    const timer=setTimeout(()=>{if(resetLeft===1)restart();else setResetLeft(resetLeft-1);},1000);
    return()=>clearTimeout(timer);
  },[phase,resetLeft]);

  async function print(){
    setPrintNote({text:'Mencetak…',failed:false});
    const r=await api.print();await refresh();
    setPrintNote(r.ok?{text:'Foto dikirim ke printer. Ambil di tray printer.',failed:false}:{text:printNotice(r.error.code),failed:true});
  }
  async function begin(t){
    setError('');setBusy(true);
    const r=await api.start(t.mode,t.id,event.name);await refresh();setBusy(false);
    if(!r.ok){fail(r);return;}
    setStage('welcome');
  }
  async function restart(){
    loop.current=null;retakeReq.current=false;setBusy(true);setError('');
    const r=await api.eventReset();await refresh();
    if(!r.ok){setBusy(false);fail(r);return;}
    handled.current=null;setUi('count');setCount(0);setQr(null);setQrError('');setPrintNote({text:'',failed:false});setStage('welcome');setBusy(false);
  }

  const header=<p className="eyebrow">{event.name.toUpperCase()} · {eventDate(event.date).toUpperCase()}</p>;
  if(!s&&stage==='pick')return <section className="screen" aria-label="Pilih template">{header}<h1>Pilih template</h1>
    <div className="gallery" role="list">{available.map(t=><button key={t.mode+t.id} role="listitem" className="tile" disabled={busy} onClick={()=>begin(t)}><Thumb api={api} mode={t.mode} id={t.id} name={t.item.name}/><b>{t.item.name}</b><span>{names[t.mode]}</span></button>)}</div>
    <div className="actions"><button onClick={()=>setStage('welcome')}>Kembali</button></div></section>;
  if(!s)return <section className="screen event-welcome" aria-label="Mode event">{header}<h1>{event.name}</h1><p className="lead event-date">{eventDate(event.date)}</p>
    {!state.configured&&<p className="alert">Kiosk belum masuk akun. Staf: buka Menu staf untuk masuk.</p>}
    {missing>0&&<p className="alert">{available.length?`${missing} template event tidak ditemukan di katalog.`:'Template event tidak ditemukan di katalog. Staf: periksa pengaturan mode event.'}</p>}
    <p className="lead">Foto otomatis: ada hitung mundur, lalu foto diambil sendiri. Sesudahnya hasilnya dicetak dan kamu bisa mengunduhnya lewat QR.</p>
    <div className="actions"><button className="primary big" disabled={busy||!state.configured||!available.length||state.busy} onClick={()=>available.length===1?begin(available[0]):setStage('pick')}>Mulai</button></div></section>;

  if(phase==='CAPTURING'||(phase==='REVIEWING'&&ui!=='process')){
    const last=s.captures.at(-1),holding=ui==='hold'&&last;
    return <section className="screen" aria-label="Sesi foto">{header}<h1>{holding?'Foto tersimpan':ui==='count'&&count>0?'Bersiap…':'Siap?'}</h1>
      <p className="eyebrow">FOTO {Math.min(s.captures.length+(holding?0:1),s.shots)} / {s.shots}</p>
      {!simulated&&phase==='CAPTURING'&&<div className={`desktop-camera${holding?' under':''}`}><CameraPreview camera={cam} label="Preview kamera"/>
        {!holding&&count>0&&<div className="count" role="status" aria-label={`Hitung mundur ${count}`}>{count}</div>}</div>}
      {holding&&<div className="hold"><img src={last.url} alt="Foto yang baru diambil"/><div className="hold-bar" role="progressbar" aria-label="Waktu untuk mengulang" aria-valuemin={0} aria-valuemax={T.retake} aria-valuenow={holdLeft}><i style={{animationDuration:T.retake+'s'}}/></div>
        <p className="lead">Tidak suka hasilnya? Ulangi dalam {holdLeft} detik, atau tunggu untuk lanjut.</p>
        <div className="actions"><button className="primary" onClick={()=>{retakeReq.current=true;}}>Ulangi foto ini</button></div></div>}
      {simulated&&!holding&&count>0&&<p role="status" className="count-inline">{count}</p>}
      {cam.error&&<><p className="alert">{cam.error}</p><button onClick={cam.reconnect}>Sambungkan ulang kamera</button></>}
      <div className="actions">{ui==='error'&&<button disabled={state.busy} onClick={()=>{loop.current=null;setUi('count');loop.current=s.id;run(s.id);}}>Coba ambil foto lagi</button>}<button disabled={state.busy} onClick={restart}>Batal</button></div></section>;
  }
  if(['REVIEWING','UPLOADING','PROCESSING','RECOVERY_REQUIRED','FAILED'].includes(phase)){
    const stuck=['RECOVERY_REQUIRED','FAILED'].includes(phase);
    return <section className="screen" aria-label="Memproses">{header}<h1>{stuck?'Foto belum selesai':'Foto sedang dibuat…'}</h1>
      {!stuck&&<p role="status" className="lead row"><span className="spinner"/>Mohon tunggu, jangan tinggalkan layar.</p>}
      {stuck&&<p className="alert">{s.error==='GENERATION_FAILED'?'Foto gagal dibuat di server.':'Koneksi ke server terputus.'}</p>}
      <div className="actions">{stuck&&s.error!=='GENERATION_FAILED'&&<button className="primary" disabled={state.busy} onClick={async()=>{setError('');const r=await api.process();await refresh();if(!r.ok)fail(r);}}>Coba lagi</button>}
        {stuck&&<button disabled={state.busy} onClick={restart}>Mulai ulang</button>}</div></section>;
  }
  // RESULT_READY
  return <section className="screen event-result" aria-label="Hasil foto">{header}<h1>Fotomu sudah jadi!</h1>
    <div className="result-grid"><img className="result-image" src={s.result} alt="Hasil foto"/>
      <div className="qr-panel">{qr?<><QRCodeSVG value={qr.url} size={220} level="M" includeMargin bgColor="#ffffff" fgColor="#26201a" title="Scan untuk mengunduh foto"/><p className="lead"><b>Scan untuk mengunduh fotomu</b></p></>
        :<p className="lead">{qrError||'Menyiapkan QR…'}</p>}
        <p role="status" className={printNote.failed?'alert':'lead'}>{printNote.text}</p>
        <div className="actions">{printNote.failed&&<button disabled={state.busy} onClick={print}>Coba cetak lagi</button>}<button className="primary" disabled={busy||state.busy} onClick={restart}>Mulai ulang</button></div>
        {resetLeft>0&&<small className="hint">Kembali otomatis dalam {resetLeft} detik.</small>}</div></div></section>;
}

/** Staff form (inside Menu staf): which event this station runs and which templates guests can use. */
export function EventSetup({api,state,refresh,fail}){
  const ev=state.event;
  const [name,setName]=useState(ev?.name||''),[date,setDate]=useState(ev?.date||''),[active,setActive]=useState(!!ev?.active);
  const key=t=>t.mode+':'+t.id;
  const [picked,setPicked]=useState(()=>new Set((ev?.templates||[]).map(key))),[saved,setSaved]=useState(''),[busy,setBusy]=useState(false);
  const toggle=k=>setPicked(p=>{const n=new Set(p);n.has(k)?n.delete(k):n.add(k);return n;});
  async function save(e){
    e.preventDefault();setBusy(true);setSaved('');
    const templates=[...picked].map(k=>{const [mode,...id]=k.split(':');return {mode,id:id.join(':')};});
    const r=await api.eventSave({name,date,templates,active});await refresh();setBusy(false);
    if(r.ok)setSaved(active?'Tersimpan. Mode event aktif.':'Tersimpan. Mode event nonaktif (kiosk memakai mode manual).');else fail(r);
  }
  const valid=name.trim()&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&picked.size>0;
  return <form onSubmit={save} aria-label="Pengaturan mode event">
    <p className="lead">Mode event: tamu tinggal menekan Mulai; foto, proses, dan cetak berjalan otomatis. Pilih satu template saja jika tamu tidak perlu memilih.</p>
    <label className="field">Nama event<input value={name} maxLength={80} onChange={e=>setName(e.target.value)} placeholder="Misalnya: Pernikahan Sarah & Arif"/></label>
    <label className="field">Tanggal event<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
    <fieldset className="templates"><legend>Template ({picked.size} dipilih)</legend>
      {['CLASSIC','BASIC','ADVANCED'].map(mode=>(state.catalog[mode]||[]).length>0&&<div key={mode}><b>{names[mode]}</b>
        {state.catalog[mode].map(c=><label key={c.id} className="check-line"><input type="checkbox" checked={picked.has(mode+':'+c.id)} onChange={()=>toggle(mode+':'+c.id)}/> {c.name}{mode==='CLASSIC'?` · ${c.shots} foto`:''}</label>)}</div>)}
      {!state.catalogLoaded&&<small className="hint">Katalog belum termuat. Periksa koneksi, lalu buka menu ini lagi.</small>}</fieldset>
    <label className="check-line"><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/> Aktifkan mode event di kiosk ini</label>
    <div className="actions"><button className="primary" disabled={busy||!valid}>Simpan mode event</button></div>
    {saved&&<p role="status">{saved}</p>}</form>;
}

import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';
const names={CLASSIC:'Classic strips',BASIC:'Basic',ADVANCED:'Advanced'};
const messages={BACKEND_NOT_CONFIGURED:'Backend belum dikonfigurasi. Foto tersimpan lokal; generation belum dijalankan.',FIXTURE_REQUIRED:'Operator perlu memilih foto untuk simulasi kamera.',CAMERA_NOT_CONNECTED:'Kamera belum terhubung.',PRINTER_NOT_CONNECTED:'Printer belum terhubung.',OPERATOR_REQUIRED:'Buka panel operator untuk membatalkan sesi ini.',PIN_INVALID:'PIN tidak sesuai.',OPERATOR_PIN_NOT_CONFIGURED:'PIN operator belum dikonfigurasi.',GENERATION_FAILED:'Generation gagal di backend. Tidak ada hasil yang dibuat.',CREDENTIAL_RECOVERY_REQUIRED:'Credential sesi tidak tersedia. Operator perlu memeriksa sesi sebelum mengulang.',PRINT_ALREADY_SUBMITTED:'Pekerjaan cetak sudah tercatat. Periksa jurnal operator.',CATALOG_UNAVAILABLE:'Katalog backend belum dapat dimuat.'};
function App(){
 const [state,setState]=useState(null),[error,setError]=useState(''),[mode,setMode]=useState('CLASSIC'),[choice,setChoice]=useState(''),[panel,setPanel]=useState(false),[operator,setOperator]=useState(false),[pin,setPin]=useState('');
 const api=window.nxbooth;
 const refresh=async()=>{const r=await api.state();if(r.ok)setState(r.data);else setError(r.error.code);};
 useEffect(()=>{if(!api){setError('Jalankan UI melalui aplikasi Electron.');return;}refresh();return api.onChange(refresh);},[]);
 async function act(method,...args){setError('');const r=await api[method](...args);if(!r.ok)setError(messages[r.error.code]||r.error.code);await refresh();}
 const s=state?.session,choices=state?.catalog[mode]||[];
 return <main><header><div><strong>NX<span>Booth</span></strong><small>DESKTOP · EVENT STATION</small></div><button className="subtle" onClick={()=>setPanel(!panel)}>Operator</button></header>
  <div className="status"><span className={state?.device.simulated?'badge':'badge neutral'}>{state?.device.simulated?'SIMULASI PERANGKAT':'PERANGKAT BELUM TERHUBUNG'}</span><span>{state?.configured?'Backend dikonfigurasi':'Capture lokal · backend belum dikonfigurasi'}</span></div>
  {error&&<p role="alert" className="alert">{error}</p>}
  {!s?<section><p className="eyebrow">MULAI SESI</p><h1>Abadikan momenmu.</h1><p>Pilih pengalaman foto, lalu lanjutkan ke pengambilan gambar.</p><div className="modes">{Object.entries(names).map(([id,name])=><button key={id} className={mode===id?'card selected':'card'} onClick={()=>{setMode(id);setChoice('');}}><b>{name}</b><span>{id==='CLASSIC'?'Beberapa pose dalam satu layout':'Satu foto untuk hasil personal'}</span></button>)}</div>
  {state?.configured&&<label>Desain <select value={choice} onChange={e=>setChoice(e.target.value)}><option value="">Pilih desain</option>{choices.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
  {state?.connectionError&&<p className="alert">{messages[state.connectionError]}</p>}
  <button className="primary" disabled={!state||state.busy||state.configured&&!choice} onClick={()=>act('start',mode,choice||undefined)}>Mulai sesi</button></section>:<section>
  <p className="eyebrow">{names[s.mode]} · {s.captures.length}/{s.shots} FOTO</p>
  <h1>{({CAPTURING:'Siap untuk pose berikutnya?',REVIEWING:'Periksa foto kamu.',UPLOADING:'Mengirim foto…',PROCESSING:'Foto sedang diproses.',RESULT_READY:'Hasil foto kamu.',RECOVERY_REQUIRED:'Sesi perlu diperiksa.',FAILED:'Generation gagal.'})[s.phase]}</h1>
  <div className="photos">{s.result?<img className="result" src={s.result} alt="Hasil generation dari backend"/>:s.captures.map((c,i)=><figure key={c.id}><img src={c.url} alt={`Foto ${i+1}`}/><figcaption>Foto {i+1}{state.device.simulated?' · simulasi':''}</figcaption></figure>)}</div>
  {s.phase==='CAPTURING'&&<p>Simulasi mengambil salinan foto pilihan operator. Live view kamera belum tersedia.</p>}
  {['UPLOADING','PROCESSING'].includes(s.phase)&&<p role="status">{s.jobStatus||'Mengirim foto ke jalur media'} · status berasal dari backend.</p>}
  {s.error&&<p className="alert">{messages[s.error]||s.error}</p>}
  <div className="actions">
  {s.phase==='CAPTURING'&&<button className="primary" disabled={state.busy} onClick={()=>act('capture')}>Ambil foto</button>}
  {['CAPTURING','REVIEWING'].includes(s.phase)&&s.captures.length>0&&<button disabled={state.busy} onClick={()=>act('retake')}>Ulangi foto terakhir</button>}
  {s.phase==='REVIEWING'&&<button className="primary" disabled={state.busy} onClick={()=>act('process')}>Proses foto</button>}
  {s.phase==='RESULT_READY'&&<><button className="primary" disabled={state.busy||s.prints.length>0} onClick={()=>act('print')}>Simulasi cetak</button><button disabled={state.busy} onClick={()=>act('finish')}>Selesai</button></>}
  </div>{s.prints.map(p=><p key={p.id}>{p.status==='SIMULATED'?'Simulasi cetak tercatat. Tidak ada kertas yang dicetak.':`Status cetak: ${p.status}. Periksa sebelum mengulang.`}</p>)}
  </section>}
  {panel&&<aside aria-label="Panel operator"><h2>Panel operator</h2>{!operator?<form onSubmit={async e=>{e.preventDefault();const r=await api.unlock(pin);setPin('');if(r.ok)setOperator(true);else setError(messages[r.error.code]||r.error.code);}}><label>PIN operator <input type="password" autoComplete="off" value={pin} onChange={e=>setPin(e.target.value)}/></label><button>Buka</button></form>:<><p>Kamera: {state?.device.camera} · Printer: {state?.device.printer}</p><p>Credential: {state?.credentialPersistence?'tersimpan terenkripsi':'hanya memori; sesi online tidak dapat dipulihkan setelah restart'}</p><button disabled={state?.busy} onClick={()=>act('chooseFixture')}>Pilih foto simulasi</button>{s&&<><button disabled={state.busy} onClick={()=>act('finish')}>Tutup sesi</button>{['RECOVERY_REQUIRED','FAILED'].includes(s.phase)&&<button disabled={state.busy} onClick={()=>act('process')}>Pulihkan proses sesi</button>}</>}<button onClick={async()=>{await api.lock();setOperator(false);}}>Kunci panel</button></>}</aside>}
  <footer>Foto tersimpan pada komputer event. Upload dan download foto menggunakan jalur media terpisah.</footer>
 </main>;
}
createRoot(document.getElementById('root')).render(<App/>);

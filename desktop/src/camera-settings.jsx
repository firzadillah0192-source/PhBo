import React,{useState} from 'react';
import {ISO_OPTIONS,AV_OPTIONS,TV_OPTIONS,OUTPUT_PRESETS} from '../shared/camera-options.mjs';

const toValue=raw=>raw===''?null:Number(raw);
function Pick({label,value,onChange,options,keep='Biarkan kamera'}){
 return <label className="field">{label}<select value={value??''} onChange={e=>onChange(toValue(e.target.value))}><option value="">{keep}</option>{options.map(o=><option key={o.code} value={o.code}>{o.label}</option>)}</select></label>;
}
/** Staff menu: ISO, aperture, shutter and output photo size. Stored on this PC and sent to the camera each time it opens. */
export function CameraSettings({api,state,refresh,fail,locked}){
 const saved=state?.cameraSettings||{iso:null,av:null,tv:null,output:'jelas'};
 const [draft,setDraft]=useState(saved),[note,setNote]=useState('');
 const dirty=JSON.stringify(draft)!==JSON.stringify(saved);
 async function save(e){
  e.preventDefault();setNote('');
  const r=await api.cameraSettingsSave(draft);
  if(r.ok){setNote('Tersimpan. Berlaku saat kamera dibuka lagi; jalankan Tes kamera Canon untuk memastikan kamera menerimanya.');await refresh();}else fail(r);
 }
 return <form onSubmit={save} className="camera-settings">
  <p>Pilihan "Biarkan kamera" tidak mengubah apa pun. ISO bisa diatur di semua mode. Bukaan (f/) dan kecepatan rana hanya diterima kamera jika dial di <b>Av, Tv, atau M</b>; di mode Av cukup atur bukaan, di Tv cukup kecepatan, di M keduanya.</p>
  <Pick label="ISO" value={draft.iso} onChange={iso=>setDraft({...draft,iso})} options={ISO_OPTIONS}/>
  <Pick label="Bukaan (f/)" value={draft.av} onChange={av=>setDraft({...draft,av})} options={AV_OPTIONS}/>
  <Pick label="Kecepatan rana (detik)" value={draft.tv} onChange={tv=>setDraft({...draft,tv})} options={TV_OPTIONS}/>
  <label className="field">Ukuran foto hasil<select value={draft.output} onChange={e=>setDraft({...draft,output:e.target.value})}>{Object.entries(OUTPUT_PRESETS).map(([id,p])=><option key={id} value={id}>{p.label}</option>)}</select>
   <small>Foto dari kamera diperkecil di komputer ini sebelum dipakai (sisi terpanjang), supaya upload dan proses lebih cepat. Foto tetap tajam untuk strip dan cetak 4R.</small></label>
  <div className="actions"><button className="primary" disabled={!dirty||locked}>Simpan pengaturan kamera</button></div>
  {locked&&<small className="hint">Tutup sesi foto dulu untuk mengubah pengaturan.</small>}
  {note&&<p role="status">{note}</p>}
 </form>;
}

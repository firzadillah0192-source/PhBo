import React,{useEffect,useState} from 'react'
import {QRCodeSVG} from 'qrcode.react'
import {prepareKioskResultClaim} from '../../kioskResultClaim.js'
export default function KioskResultQr({resultId}){
 const [claim,setClaim]=useState(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[expired,setExpired]=useState(false),[revision,setRevision]=useState(0),[refresh,setRefresh]=useState(false),[replace,setReplace]=useState(false)
 useEffect(()=>{
  let alive=true
  setClaim(null);setBusy(true);setError('');setExpired(false);setReplace(false)
  prepareKioskResultClaim(resultId,{refresh}).then(next=>{if(alive){setClaim(next);setExpired(Date.parse(next.expires_at)<=Date.now())}}).catch(e=>{if(alive){setReplace(e.status===409);setError(e.status===409?'Link QR sebelumnya sudah ada atau perlu diperbarui.':'QR belum dapat dibuat. Periksa koneksi dan coba lagi.')}}).finally(()=>{if(alive)setBusy(false)})
  return()=>{alive=false}
 },[resultId,revision,refresh])
 useEffect(()=>{if(!claim)return;const timer=setTimeout(()=>setExpired(true),Math.max(0,Math.min(2147483647,Date.parse(claim.expires_at)-Date.now())));return()=>clearTimeout(timer)},[claim])
 const expiry=claim?new Date(claim.expires_at).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'}):''
 return <section className="kv-result-qr" aria-label="QR hasil foto"><h2>Scan untuk simpan di HP</h2>{claim&&!expired?<><QRCodeSVG value={claim.qr_payload} size={224} level="M" includeMargin bgColor="#ffffff" fgColor="#26201a" title="QR hasil foto"/><a href={claim.claim_url} target="_blank" rel="noopener noreferrer">Buka link foto ↗</a><small>Berlaku sampai {expiry}.</small></>:<p role="status">{busy?'Menyiapkan QR…':expired?'Link QR sudah kedaluwarsa.':'QR belum tersedia.'}</p>}{error&&<p role="alert">{error}</p>}{!busy&&(error||expired)&&<button className="kv-secondary" onClick={()=>{setRefresh(replace||expired);setRevision(n=>n+1)}}>{replace||expired?'Buat QR baru':'Coba QR lagi'}</button>}</section>
}

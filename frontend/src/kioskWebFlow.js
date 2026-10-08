import {getClassicLayouts,getTemplates,getExperiences,getFrameStyles,getUsage} from './kioskWebApi.js'
const KEY='nxbooth:kiosk-web-job'
export async function loadKioskWebCatalog(){
 const results=await Promise.allSettled([getClassicLayouts(),getTemplates(),getExperiences(),getFrameStyles(),getUsage()])
 const value=i=>results[i].status==='fulfilled'?results[i].value:null
 return {CLASSIC:(value(0)||[]).filter(x=>x.enabled!==false),BASIC:(value(1)?.templates||[]).filter(x=>x.enabled!==false&&x.basic_available!==false),ADVANCED:(value(2)?.experiences||[]).filter(x=>x.enabled!==false),styles:(value(3)||[]).filter(x=>x.enabled!==false),usage:value(4),errors:results.slice(0,4).some(x=>x.status==='rejected')}
}
export function selectionOptions(mode,selection,styleId,ids){
 if(!selection?.id||!['CLASSIC','BASIC','ADVANCED'].includes(mode))throw new Error('Pilih desain terlebih dahulu.')
 const shots=mode==='CLASSIC'?selection.shot_count:1
 if(!Number.isInteger(shots)||shots<1||shots>4||ids.length!==shots||new Set(ids).size!==shots)throw new Error('Jumlah foto belum sesuai desain.')
 return {layoutId:mode==='CLASSIC'?selection.id:undefined,captureUploadIds:mode==='CLASSIC'?ids:undefined,frameStyleId:mode==='ADVANCED'?styleId:undefined,ornamentIds:[]}
}
export function readKioskWebJob(storage=globalThis.sessionStorage){try{const s=JSON.parse(storage.getItem(KEY));return s&&/^[a-zA-Z0-9_-]{1,128}$/.test(s.jobId)&&['CLASSIC','BASIC','ADVANCED'].includes(s.mode)?s:null}catch{return null}}
export function saveKioskWebJob(job,storage=globalThis.sessionStorage){try{storage.setItem(KEY,JSON.stringify({jobId:job.jobId,mode:job.mode}))}catch{}}
export function clearKioskWebJob(storage=globalThis.sessionStorage){try{storage.removeItem(KEY)}catch{}}
export function kioskWebError(error){
 const messages={AI_PROVIDER_NOT_CONNECTED:'Layanan AI belum terhubung.',BASIC_ENGINE_NOT_CONNECTED:'Engine Basic belum terhubung.',AI_QUOTA_EXHAUSTED:'Kredit AI tidak cukup. Buka akun untuk memeriksa kredit.',UPLOAD_EXPIRED:'Foto sudah kedaluwarsa. Mulai sesi baru.',UPLOAD_NOT_FOUND:'Foto tidak tersedia. Mulai sesi baru.',GENERATION_FAILED:'Proses gagal di backend. Tidak ada hasil yang dibuat.',IMAGE_DECODE_FAILED:'Foto tidak dapat dibaca oleh backend.',VALIDATION_FAILED:'Foto atau pilihan desain belum sesuai ketentuan backend.'}
 if(error?.status===402)return 'Kredit AI tidak cukup. Buka akun untuk memeriksa kredit.'
 return messages[error?.errorCode]||([401,403].includes(error?.status)?'Akses sesi tidak tersedia. Mulai sesi baru.':'Koneksi atau proses backend bermasalah. Periksa koneksi lalu coba lagi.')
}

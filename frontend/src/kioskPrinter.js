// Pairing is local to this tab. No token in URLs, cookies, localStorage or analytics.
let pairingCode=''
const base='http://127.0.0.1:20253/v1'
const id=value=>{if(typeof value!=='string'||! /^[a-zA-Z0-9_-]{1,128}$/.test(value))throw new Error('PRINT_REQUEST_INVALID');return value}
async function request(path,body){
 if(globalThis.window?.nxboothPrinter){
  const api=window.nxboothPrinter
  const r=path==='/status'?await api.status():path.startsWith('/jobs/')?await api.job(path.slice(6)):await api.submit(body)
  if(!r.ok)throw new Error(r.error?.code||'PRINTER_UNAVAILABLE')
  return r.data
 }
 if(!pairingCode)throw new Error('PRINTER_PAIRING_REQUIRED')
 let response
 try{response=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+pairingCode,...body?{'Content-Type':'application/json'}:{}},body:body?JSON.stringify(body):undefined,redirect:'error',credentials:'omit',signal:AbortSignal.timeout(body?125000:15000)})}
 catch{throw new Error(body?'PRINT_OUTCOME_UNKNOWN':'PRINTER_APP_UNAVAILABLE')}
 const r=await response.json()
 if(!response.ok)throw new Error(r.error?.code||'PRINTER_UNAVAILABLE')
 return r.data
}
export const hasDesktopPrinter=()=>!!globalThis.window?.nxboothPrinter
export const getPrinterStatus=()=>request('/status')
export const getPrintJob=resultId=>request('/jobs/'+id(resultId))
export async function pairPrinter(value){
 if(!/^[A-Za-z0-9_-]{43}$/.test(value||''))throw new Error('PRINTER_PAIRING_CODE_INVALID')
 pairingCode=value
 try{return await getPrinterStatus()}catch(error){pairingCode='';throw error}
}
export function disconnectPrinter(){pairingCode=''}
export async function submitPrint(resultId,mode,imageUrl){
 id(resultId)
 if(!['CLASSIC','BASIC','ADVANCED'].includes(mode))throw new Error('PRINT_REQUEST_INVALID')
 const location=new URL(imageUrl,globalThis.location?.origin||'https://nxbooth.gennexbyte.com')
 if(location.origin!==(globalThis.location?.origin||'https://nxbooth.gennexbyte.com')||location.pathname!==`/api/kiosk/web/results/${resultId}/image`||location.search||location.hash)throw new Error('PRINT_IMAGE_URL_INVALID')
 // Read only this authenticated backend Result. No client-provided file paths.
 const response=await fetch(location.href,{credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(60000)})
 if(!response.ok)throw new Error('PRINT_RESULT_UNAVAILABLE')
 if(!['image/png','image/jpeg'].includes(response.headers.get('content-type')?.split(';')[0]))throw new Error('PRINT_IMAGE_INVALID')
 if(Number(response.headers.get('content-length'))>16*1024*1024)throw new Error('PRINT_IMAGE_TOO_LARGE')
 const reader=response.body.getReader();const chunks=[];let length=0
 while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>16*1024*1024){await reader.cancel();throw new Error('PRINT_IMAGE_TOO_LARGE')}chunks.push(value)}
 const blob=new Blob(chunks,{type:response.headers.get('content-type')})
 const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(new Error('PRINT_IMAGE_INVALID'));reader.readAsDataURL(blob)})
 return request('/print',{resultId,profile:mode==='CLASSIC'?'classic-two-strips-4r':'photo-4r',base64})
}
export function printerMessage(code){return ({
 PRINTER_PAIRING_REQUIRED:'Hubungkan aplikasi NXBooth di komputer ini melalui panel Operator.',
 PRINTER_APP_UNAVAILABLE:'Aplikasi NXBooth belum terhubung. Jalankan aplikasi dan izinkan akses jaringan lokal di browser.',
 PRINTER_PAIRING_CODE_INVALID:'Kode koneksi harus disalin dari panel Operator aplikasi NXBooth.',
 PRINTER_NOT_CONNECTED:'Epson L8050 belum ditemukan. Periksa kabel dan driver Windows.',
 PRINTER_SELECTION_REQUIRED:'Ada lebih dari satu L8050. Pilih printer lewat pengaturan aplikasi.',
 PRINT_ENABLE_4R_BORDERLESS:'Atur Epson L8050 ke kertas 4R / 4 × 6 inci dan Borderless, lalu coba lagi.',
 PRINT_4R_PAPER_UNAVAILABLE:'Driver printer belum menyediakan ukuran 4R. Install driver resmi Epson L8050.',
 PRINT_ALREADY_SUBMITTED:'Hasil ini sudah dikirim atau status cetaknya belum pasti. Periksa printer sebelum mengulang.',
 PRINT_BUSY:'Printer sedang menerima pekerjaan lain. Tunggu sebentar.',
 PRINT_OUTCOME_UNKNOWN:'Status pengiriman belum pasti. Periksa printer; jangan cetak ulang untuk menghindari duplikat.',
 PRINT_CLASSIC_SIZE_INVALID:'Ukuran strip tidak sesuai profil cetak. Gunakan hasil Classic terbaru.',
 PRINT_RESULT_UNAVAILABLE:'Hasil foto belum dapat diambil dari backend.',
 PRINTER_UNAVAILABLE:'Printer belum tersedia.',
 })[code]||'Cetak belum dapat dijalankan. Periksa koneksi aplikasi dan printer.'}

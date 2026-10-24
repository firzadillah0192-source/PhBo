import React,{useEffect,useRef,useState} from 'react'
import {exploreGenerationApi,exploreStorageApi} from '../../api.js'
const pretty=value=>JSON.stringify(value,null,2)
export default function GenerationApiExplorer({enabled}){
 const [token,setToken]=useState(''),[templates,setTemplates]=useState([]),[template,setTemplate]=useState(''),[file,setFile]=useState(null),[preview,setPreview]=useState(''),[input,setInput]=useState(null),[folder,setFolder]=useState(''),[job,setJob]=useState(null),[requestKey,setRequestKey]=useState(''),[ack,setAck]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[response,setResponse]=useState(''),[rejected,setRejected]=useState(false)
 const controller=useRef(null),download=useRef(null),fileInput=useRef(null),mounted=useRef(true)
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort();if(download.current)URL.revokeObjectURL(download.current)}},[])
 useEffect(()=>{if(!file){setPreview('');return}const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url)},[file])
 function reset(){controller.current?.abort();setFile(null);if(fileInput.current)fileInput.current.value='';setInput(null);setJob(null);setRequestKey('');setAck(false);setResponse('');setError('');setFolder('');setRejected(false)}
 async function act(action){setRejected(false);setError('');setBusy(true);controller.current=new AbortController();try{let result
  if(action==='download') {result=await exploreStorageApi({token,endpoint:'download',resultId:job.result_id,signal:controller.current.signal});if(download.current)URL.revokeObjectURL(download.current);download.current=URL.createObjectURL(result.blob);const link=document.createElement('a');link.href=download.current;link.download=`nxbooth-${job.result_id}.png`;link.click();if(mounted.current)setResponse('Hasil diunduh.');return}
  const key=action==='generate'?(requestKey||globalThis.crypto.randomUUID()):undefined
  if(action==='generate')setRequestKey(key)
  result=await exploreGenerationApi({token,action,file,id:job?.job_id,requestKey:key,body:action==='generate'?{template_id:template,input_id:input.input_id,...(folder?{folder_id:folder==='unfiled'?null:folder}:{})}:undefined,signal:controller.current.signal})
  if(!mounted.current)return
  if(action==='templates'){setTemplates(result.data.templates);setTemplate(result.data.templates[0]?.id||'')}
  if(action==='upload'){setInput(result.data);setJob(null);setRequestKey('')}
  if(action==='generate'||action==='status')setJob(result.data)
  setResponse(`HTTP ${result.status}\n${pretty(result.data)}`)
 }catch(e){if(mounted.current&&e.name!=='AbortError'){setError(e.message||'Request gagal.');setRejected(Boolean(e.definitiveRejection))}}finally{if(mounted.current)setBusy(false)}}
 const frozen=Boolean(requestKey||job),selected=templates.find(t=>t.id===template),cost=selected?.credit_cost
 return <section className="account-panel api-key-form" aria-label="Generation Explorer"><h2>Generation API Explorer</h2><p>{enabled?'Generate gambar nyata memakai saldo akun pemilik key.':'API generation belum diaktifkan. Dokumentasi alurnya sudah tersedia.'}</p><p>Key membutuhkan <code>catalog:read, inputs:write, generations:create, generations:read, results:read</code>. Jalur Standard, 50 AI Credit per gambar. Retensi dan storage mengikuti paket akun.</p>
 <label>Secret Key generation<input type="password" className="ph-no-capture ph-mask" autoComplete="off" spellCheck={false} value={token} disabled={busy} onChange={e=>{reset();setTemplates([]);setTemplate('');setToken(e.target.value)}} /></label><button type="button" className="account-text-button" disabled={busy} onClick={()=>{reset();setToken('');setTemplates([]);setTemplate('')}}>Hapus key generation & data</button>
 <button type="button" className="account-outline-button" disabled={!enabled||busy||!token||frozen} onClick={()=>act('templates')}>1. Ambil template</button>
 <label>Template API<select aria-label="Template API" value={template} disabled={busy||frozen} onChange={e=>{setTemplate(e.target.value);setAck(false)}}><option value="">Pilih template</option>{templates.map(t=><option key={t.id} value={t.id}>{t.name} — {t.credit_cost} AI Credit</option>)}</select></label>
 <label>Foto untuk API<input ref={fileInput} type="file" accept=".jpg,.jpeg,.png,.webp,.heic,.heif" disabled={busy||frozen} onChange={e=>{setFile(e.target.files[0]||null);setInput(null);setAck(false)}} /></label>{preview&&<img className="api-input-preview ph-no-capture ph-mask" src={preview} alt="Pratinjau foto input API" />}
 <button type="button" className="account-outline-button" disabled={!enabled||busy||!token||!file||frozen} onClick={()=>act('upload')}>2. Upload foto</button>{input&&<p>Input siap sampai {new Date(input.expires_at).toLocaleString('id-ID')}.</p>}
 <label>Folder tujuan (opsional)<input value={folder} disabled={busy||frozen} placeholder="Kosong = default; unfiled = tanpa folder" onChange={e=>setFolder(e.target.value)} /></label>
 <label className="api-checkbox"><input type="checkbox" checked={ack} disabled={busy||frozen} onChange={e=>setAck(e.target.checked)} />Saya setuju menggunakan {cost??50} AI Credit untuk request generate ini.</label>
 <button type="button" className="account-outline-button" disabled={!enabled||busy||!ack||!input||!template||Boolean(job)||cost!==50} onClick={()=>act('generate')}>{requestKey?'3. Kirim ulang request yang sama':'3. Generate — 50 AI Credit'}</button>
 {requestKey&&<p>Idempotency-Key: <code>{requestKey}</code>. Jika request terganggu, kirim ulang dengan key dan isi yang sama agar tidak membuat job ganda.</p>}
 {job&&<><p role="status">Status job: <strong>{job.state}</strong>{job.state==='FAILED'&&<> — {job.error_code||'GENERATION_FAILED'}. Periksa <code>credit_charge.status</code> pada respons untuk status pengembalian kredit.</>}</p>{(!['COMPLETED','FAILED'].includes(job.state)||job.state==='COMPLETED'&&!job.result_id||job.state==='FAILED'&&!job.credit_charge)&&<button type="button" className="account-outline-button" disabled={busy} onClick={()=>act('status')}>4. Cek status (beri jeda 3 detik)</button>}{job.state==='COMPLETED'&&job.result_id&&<button type="button" className="account-outline-button" disabled={busy} onClick={()=>act('download')}>5. Unduh hasil</button>}</>}
 {frozen&&<button type="button" className="account-text-button" disabled={busy||!rejected&&(!job||!['COMPLETED','FAILED'].includes(job.state))} onClick={reset}>Mulai request baru</button>}
 {error&&<p role="alert">{error}</p>}{response&&<pre aria-label="Respons generation API" className="ph-no-capture ph-mask">{response}</pre>}
 </section>
}

import React,{useCallback,useEffect,useRef,useState} from 'react'
import CustomerNav from './CustomerNav.jsx'
import DuetCamera from './DuetCamera.jsx'
import { createDuetTemplate,deleteDuetTemplate,getAccountMe,getDuetCapabilities,getDuetTemplate,getDuetTemplates,getUsage,updateDuetTemplate,uploadPhoto } from '../../api.js'
import { useT } from '../../i18n.js'
import './nxduet.css'

function readPending(account){try{const data=JSON.parse(sessionStorage.getItem('nxduet-preparation'));return data?.account===account?data:null}catch{return null}}
export function DuetEntryLink(){
  const t=useT(),[enabled,setEnabled]=useState(false)
  useEffect(()=>{let active=true;getDuetCapabilities().then(data=>{if(active)setEnabled(data.enabled)}).catch(()=>{});return()=>{active=false}},[])
  return enabled?<section className="duet-entry" aria-labelledby="duet-entry-title">
    <div className="duet-entry-copy"><span className="duet-entry-tag">{t('Fitur terpisah · bukan mode kreasi','Separate feature · not a creation mode')}</span><h2 id="duet-entry-title">NXDuet</h2><p>{t('Foto bersama orang terkasih, meski terpisah jarak. Simpan teman foto di akunmu dan pakai kapan saja.','A photo with someone you love, even when you are apart. Save a companion to your account and reuse it anytime.')}</p></div>
    <a className="duet-entry-cta" href="/nxduet">{t('Buka NXDuet','Open NXDuet')} <span aria-hidden="true">→</span></a>
  </section>:null
}
function PoseStrip({poses,name}){
  const ready=(poses??[]).filter(pose=>pose.image_url)
  return ready.length?<div className="duet-pose-strip">{ready.map(pose=><figure key={pose.slot}><div className="duet-overlay-preview"><img src={pose.image_url} alt={`Teman foto ${name}, pose ${pose.label}`} loading="lazy"/></div><figcaption>{pose.slot}. {pose.label}</figcaption></figure>)}</div>:null
}
export default function NXDuet(){
  const [account,setAccount]=useState(null),[usage,setUsage]=useState(null),[capabilities,setCapabilities]=useState(null),[templates,setTemplates]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loginRequest,setLoginRequest]=useState(0)
  const [drag,setDrag]=useState(false),[creating,setCreating]=useState(false),[file,setFile]=useState(null),[preview,setPreview]=useState(null),[name,setName]=useState('Teman fotoku'),[accepted,setAccepted]=useState(false),[selected,setSelected]=useState(null),[camera,setCamera]=useState(false),[help,setHelp]=useState(false),[revision,setRevision]=useState(0),[offset,setOffset]=useState(0),[poses,setPoses]=useState([])
  const fileInput=useRef(null),helpDialog=useRef(null),pending=useRef(null),submitLock=useRef(false),mounted=useRef(true)
  const refreshAccount=useCallback(async()=>{
    const next=await getUsage();if(!mounted.current)return
    const who=next.authenticated?await getAccountMe():null;if(!mounted.current)return
    setUsage(next);setAccount(who);setSelected(null);setCamera(false)
  },[])
  useEffect(()=>{mounted.current=true;Promise.all([getDuetCapabilities(),refreshAccount()]).then(([data])=>{if(mounted.current)setCapabilities(data)}).catch(e=>{if(mounted.current)setError(e.message)}).finally(()=>{if(mounted.current)setLoading(false)});return()=>{mounted.current=false}},[refreshAccount])
  useEffect(()=>{
    setTemplates([]);setSelected(null);setCamera(false);pending.current=account?.analytics_id?readPending(account.analytics_id):null
    if(pending.current&&!Array.isArray(pending.current.body.poses)){pending.current=null;sessionStorage.removeItem('nxduet-preparation')}
    if(pending.current){setName(pending.current.body.name);setPoses(pending.current.body.poses)}
    if(!account?.analytics_id||!capabilities?.enabled)return
    let active=true;setLoading(true)
    getDuetTemplates(offset).then(data=>{if(active)setTemplates(data.templates)}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)})
    return()=>{active=false}
  },[account?.analytics_id,capabilities?.enabled,revision,offset])
  useEffect(()=>{if(capabilities?.poses?.length>=3)setPoses(current=>current.length===3?current:capabilities.poses.slice(0,3).map(pose=>pose.key))},[capabilities])
  useEffect(()=>{if(!file){setPreview(null);return}const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url)},[file])
  useEffect(()=>{
    if(!selected||!['QUEUED','PROCESSING'].includes(selected.state))return
    let active=true,timer
    const poll=async()=>{try{const next=await getDuetTemplate(selected.id);if(!active)return;setSelected(next);if(['QUEUED','PROCESSING'].includes(next.state))timer=setTimeout(poll,2500);else{setTemplates(rows=>[next,...rows.filter(item=>item.id!==next.id)]);getUsage().then(data=>{if(active)setUsage(data)}).catch(()=>{})}}catch(e){if(active){setError(e.message);timer=setTimeout(poll,5000)}}}
    poll();return()=>{active=false;clearTimeout(timer)}
  },[selected?.id,selected?.state])
  useEffect(()=>{if(help&&!helpDialog.current?.open)helpDialog.current?.showModal();else if(!help)helpDialog.current?.close()},[help])
  const chooseFile=next=>{
    if(next&&!/\.(jpe?g|png|webp|heic|heif)$/i.test(next.name)&&!/^image\/(jpeg|png|webp|heic|heif)$/.test(next.type)){setError('Format foto tidak didukung. Pilih JPEG, PNG, WebP, HEIC, atau HEIF.');return}
    if(next&&next.size>12*1024*1024){setError(`Foto ${(next.size/1048576).toFixed(1)} MB terlalu besar. Maksimal 12 MB.`);return}
    setFile(next);pending.current=null;sessionStorage.removeItem('nxduet-preparation');setError('')
  }
  const create=async event=>{
    event.preventDefault();if(submitLock.current||!account||!accepted)return
    if(!file&&!pending.current){setError('Pilih foto terlebih dahulu.');return}
    submitLock.current=true;setBusy(true);setError('')
    try{
      if(!pending.current){const upload=await uploadPhoto(file);pending.current={account:account.analytics_id,key:crypto.randomUUID(),body:{upload_id:upload.upload_id,name:name.trim(),poses,rights_accepted:true}};sessionStorage.setItem('nxduet-preparation',JSON.stringify(pending.current))}
      const template=await createDuetTemplate(pending.current.body,pending.current.key)
      sessionStorage.removeItem('nxduet-preparation');pending.current=null
      if(mounted.current){setSelected(template);setCreating(false);setFile(null);setAccepted(false);getUsage().then(data=>{if(mounted.current)setUsage(data)}).catch(()=>{})}
    }catch(e){if(mounted.current)setError(e.message)}finally{submitLock.current=false;if(mounted.current)setBusy(false)}
  }
  const open=async item=>{setBusy(true);setError('');try{const current=await getDuetTemplate(item.id);setSelected(current);setCreating(false)}catch(e){setError(e.message)}finally{setBusy(false)}}
  const rename=async event=>{event.preventDefault();setBusy(true);setError('');try{const current=await updateDuetTemplate(selected.id,{name:event.currentTarget.elements.templateName.value});setSelected(current);setTemplates(rows=>rows.map(item=>item.id===current.id?current:item))}catch(e){setError(e.message)}finally{setBusy(false)}}
  const remove=async item=>{if(!window.confirm(`Hapus template “${item.name}”? Penyiapan baru memakai 100 kredit.`))return;setBusy(true);setError('');try{await deleteDuetTemplate(item.id);setSelected(null);setRevision(v=>v+1)}catch(e){setError(e.message)}finally{setBusy(false)}}
  const balance=usage?.subscription?.ai?.remaining??usage?.ai_remaining??0
  return <div className="customer-app retro-app duet-app">
    <CustomerNav usage={usage} account={account} onHome={()=>{location.href='/'}} onMode={mode=>{location.href='/create?mode='+mode.toLowerCase()}} onUsageChanged={refreshAccount} onAccountNavigate={tab=>{location.href='/account?tab='+tab}} openRequest={loginRequest}/>
    <main className="duet-main" id="studio-main">
      <header className="duet-heading"><div><p className="customer-kicker">Beda dunia, satu frame.</p><h1>NXDuet</h1><p>Foto bersama orang terkasih, meski terpisah jarak.</p></div><button type="button" aria-label="Panduan NXDuet" onClick={()=>setHelp(true)}>?</button></header>
      {error&&<div className="duet-error" role="alert">{error}<button onClick={()=>setError('')} aria-label="Tutup pesan">×</button></div>}
      {loading&&!camera&&<p role="status">Memuat NXDuet…</p>}
      {capabilities&&!capabilities.enabled?<section className="duet-card"><h2>NXDuet belum tersedia.</h2><p>Penyiapan teman foto belum diaktifkan. Kredit belum dipotong.</p><a href="/create">Kembali ke studio</a></section>:!account&&!loading?<section className="duet-card"><h2>Simpan teman fotomu dalam satu tempat.</h2><p>Masuk untuk membuat dan membuka template privat milikmu.</p><button className="duet-primary" onClick={()=>setLoginRequest(v=>v+1)}>Masuk / Daftar</button></section>:account&&capabilities?.enabled?<>
      {camera&&selected?<DuetCamera key={selected.id} template={selected} frame={capabilities.frame} onBack={()=>{setCamera(false);setSelected(null);setRevision(v=>v+1)}}/>:selected?<section className="duet-card">
        <button onClick={()=>{setSelected(null);setRevision(v=>v+1)}}>← Template Saya</button><h2>{selected.name}</h2>
        {['QUEUED','PROCESSING'].includes(selected.state)?<div role="status"><h3>Menyiapkan teman foto…</h3><p>{selected.state==='QUEUED'?'Menunggu giliran penyiapan.':'Tiga pose teman foto sedang dibuat dan dipotong sekitar 3/4 badan.'}</p><p>100 kredit direservasi. Template otomatis tersimpan setelah berhasil; kamu bisa kembali ke halaman ini nanti.</p></div>:selected.state==='FAILED'?<><p role="alert">Penyiapan belum berhasil. Reservasi kredit sudah dikembalikan sesuai masa berlaku saldo.</p><button onClick={()=>{setSelected(null);setCreating(true)}}>Buat penyiapan baru · 100 kredit</button></>:!selected.enabled?<p>Template dinonaktifkan oleh admin. Hubungi pengelola untuk bantuan.</p>:<>
          <p className="duet-saved">✓ Template tersimpan di akunmu</p><PoseStrip poses={selected.poses} name={selected.name}/>
          <form onSubmit={rename}><label>Nama template <input name="templateName" defaultValue={selected.name} maxLength={80} required/></label><button disabled={busy}>Ubah nama</button></form>
          <div className="duet-actions"><button className="duet-primary" disabled={busy} onClick={()=>setCamera(true)}>Mulai foto</button><button disabled={busy} onClick={()=>remove(selected)}>Hapus template</button></div><p>Memakai template ini tidak membutuhkan penyiapan AI baru.</p>
        </>}
      </section>:creating?<section className="duet-card"><button disabled={busy} onClick={()=>setCreating(false)}>← Template Saya</button><h2>Buat teman foto</h2><p>Satu foto menjadi tiga pose berbeda. Foto boleh full badan: teman foto otomatis dipotong sekitar 3/4 badan dan disesuaikan dengan frame strip.</p>
        <form onSubmit={create}><label>Nama template <input value={name} maxLength={80} required disabled={busy||Boolean(pending.current)} onChange={e=>setName(e.target.value)}/></label>
          <fieldset className="duet-poses" disabled={busy||Boolean(pending.current)}><legend>Pilih tiga pose · satu pose per foto</legend>
            {[0,1,2].map(i=><label key={i}>Foto {i+1}<select aria-label={`Pose foto ${i+1}`} value={poses[i]??''} onChange={e=>setPoses(list=>list.map((key,j)=>j===i?e.target.value:key))}>{(capabilities.poses??[]).map(pose=><option key={pose.key} value={pose.key} disabled={poses.some((key,j)=>j!==i&&key===pose.key)}>{pose.label}</option>)}</select></label>)}
          </fieldset><div className="duet-field"><span>Foto temanmu</span>
            <button type="button" className={'duet-drop'+(drag?' is-drag':'')+(file?' has-file':'')} disabled={busy} onClick={()=>fileInput.current?.click()} onDragOver={e=>{e.preventDefault();setDrag(true)}} onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);if(!busy)chooseFile(e.dataTransfer.files?.[0]??null)}}>
              <strong>{file?file.name:'Pilih atau tarik foto ke sini'}</strong><small>{file?`${(file.size/1048576).toFixed(1)} MB · ketuk untuk mengganti`:'JPEG, PNG, WebP, HEIC atau HEIF · maks. 12 MB'}</small>
            </button>
            <input ref={fileInput} type="file" accept="image/*,.heic,.heif" hidden onChange={e=>{const next=e.target.files?.[0]??null;e.target.value='';if(next)chooseFile(next)}}/></div>
          {preview&&<img className="duet-upload-preview" src={preview} alt="Foto yang dipilih untuk penyiapan" onError={()=>setError('Preview foto ini tidak dapat ditampilkan. HEIC akan diperiksa saat diunggah.')}/>}
          {pending.current&&<p>Permintaan sebelumnya dapat diperiksa ulang dengan tombol di bawah. Pemeriksaan ulang tidak menagih dua kali.</p>}
          <label className="duet-check"><input type="checkbox" checked={accepted} disabled={busy} onChange={e=>setAccepted(e.target.checked)}/>Saya memiliki hak atau izin untuk menggunakan dan mengolah gambar ini, serta persetujuan orang yang ditampilkan apabila diperlukan.</label>
          <p>Penyiapan memakai <strong>100 AI Credit</strong>. Saldo tersedia: {balance}. Jika gagal, reservasi dikembalikan sesuai masa berlaku saldo. Template berhasil otomatis disimpan privat di akunmu.</p>
          {capabilities.frame?.ready===false&&<p role="alert">Frame strip NXDuet belum tersedia. Kredit belum dipotong.</p>}
          <button className="duet-primary" disabled={busy||!accepted||(!file&&!pending.current)||!name.trim()||poses.length!==3||new Set(poses).size!==3||capabilities.frame?.ready===false}>{busy?'Mengirim penyiapan…':pending.current?'Periksa / lanjutkan permintaan':'Siapkan template · 100 kredit'}</button>
        </form>
      </section>:<section><div className="duet-library-heading"><div><h2>Template Saya</h2><p>Hanya kamu yang bisa memakai template ini. Pengelola dapat meninjau dan mengelolanya.</p></div><button className="duet-primary" onClick={()=>{setCreating(true);setError('')}}>Buat template baru · 100 kredit</button></div>
        {!loading&&templates.length===0&&<div className="duet-card"><h3>{offset?'Tidak ada template lagi.':'Belum punya teman foto?'}</h3><p>Upload foto orang terkasih dan siapkan template pertamamu. Buka tombol ? untuk panduannya.</p></div>}
        <div className="duet-grid">{templates.map(item=><article className="duet-card" key={item.id}>{item.image_url?<PoseStrip poses={item.poses} name={item.name}/>:<p>{item.state==='FAILED'?'Penyiapan gagal':item.enabled?'Sedang disiapkan':'Dinonaktifkan'}</p>}<h3>{item.name}</h3><p>{item.state==='COMPLETED'?(item.enabled?'Siap dipakai':'Dinonaktifkan admin'):item.charge_status==='REFUNDED'?'Reservasi dikembalikan':'Penyiapan berlangsung'}</p><button disabled={busy} onClick={()=>open(item)}>Buka template</button></article>)}</div>
        {(offset>0||templates.length===50)&&<div className="duet-actions"><button disabled={offset===0} onClick={()=>setOffset(v=>Math.max(0,v-50))}>Sebelumnya</button><button disabled={templates.length<50} onClick={()=>setOffset(v=>v+50)}>Berikutnya</button></div>}
      </section>}
      </>:null}
      <dialog ref={helpDialog} className="duet-help" onCancel={()=>setHelp(false)} onClose={()=>setHelp(false)} aria-labelledby="duet-help-title"><h2 id="duet-help-title">Cara memakai NXDuet</h2><ol><li>Masuk ke akun dan pilih Buat template baru.</li><li>Upload foto satu orang dengan wajah jelas. Foto boleh full badan dari kepala sampai kaki; teman foto otomatis dipotong sekitar 3/4 badan. Hindari kepala atau tangan terpotong. Pastikan kamu punya izin menggunakannya.</li><li>Pilih tiga pose, misalnya tersenyum, marah, atau peluk. Setiap pose dipakai untuk satu foto di strip.</li><li>Siapkan template dengan 100 kredit. Waktu penyiapan bergantung pada proses gambar; jangan tutup halaman jika unggahan masih berlangsung.</li><li>Setelah berhasil, template otomatis tersimpan privat di akunmu dan bisa dibuka dari perangkat lain.</li><li>Buka template, izinkan kamera, lalu atur ukuran teman foto. Teman foto selalu di sisi kiri, jadi berdirilah di sisi kanan.</li><li>Ambil tiga foto dan unduh photo strip dengan frame Classic 3 foto. Memakai ulang template tidak memanggil penyiapan AI lagi.</li></ol><p>Setiap pose adalah gambar diam. Tanganmu bisa tertutup gambar jika melewati area teman foto.</p><button onClick={()=>setHelp(false)}>Mengerti</button></dialog>
    </main>
  </div>
}

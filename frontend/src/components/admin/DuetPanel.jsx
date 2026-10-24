import React,{useEffect,useState} from 'react'
import { clearAdminReadCache,controlAdminDuetTemplate,getAdminDuetTemplates } from '../../api.js'

export default function DuetPanel(){
  const [rows,setRows]=useState([]),[account,setAccount]=useState(''),[filter,setFilter]=useState(''),[offset,setOffset]=useState(0),[revision,setRevision]=useState(0),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false)
  useEffect(()=>{let active=true;setLoading(true);setError('');clearAdminReadCache();getAdminDuetTemplates(filter,offset).then(data=>{if(active)setRows(data.templates)}).catch(e=>{if(active)setError(e.errorCode==='HTTP_404'?'NXDuet belum diaktifkan.':e.message)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[filter,offset,revision])
  const control=async(row,action)=>{
    if(action==='delete'&&!window.confirm(`Hapus template “${row.name}” milik akun ${row.account_id}?`))return
    const reason=window.prompt('Alasan tindakan admin (minimal 3 karakter):');if(!reason)return
    setBusy(true);setError('');try{await controlAdminDuetTemplate(row.id,{action,reason});setRevision(v=>v+1)}catch(e){setError(e.message)}finally{setBusy(false)}
  }
  return <section className="admin-card"><h2>NXDuet · Template pengguna</h2><p>Penyiapan: 100 AI Credit. Penghapusan template yang berhasil tidak mengembalikan biaya penyiapan.</p>
    <form onSubmit={e=>{e.preventDefault();setOffset(0);setFilter(account.trim())}}><label>Filter ID akun <input value={account} onChange={e=>setAccount(e.target.value)} placeholder="Kosongkan untuk semua akun"/></label><button>Cari</button><button type="button" onClick={()=>setRevision(v=>v+1)}>Muat ulang</button></form>
    {error&&<p className="admin-error" role="alert">{error}</p>}{loading?<p role="status">Memuat template…</p>:<div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Template / akun</th><th>Status</th><th>Kredit</th><th>Tindakan</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td><strong>{row.name}</strong><br/><small>{row.account_id}</small>{row.state==='COMPLETED'&&!row.deleted_at&&<details><summary>Lihat gambar privat</summary><img style={{maxWidth:160,maxHeight:180,objectFit:'contain',background:'#63596c'}} src={`/api/admin/nxduet/templates/${row.id}/image`} alt={`Template privat ${row.name}`} loading="lazy"/></details>}</td><td>{row.deleted_at?'Dihapus':row.enabled?row.state:'Dinonaktifkan'}{row.error_code&&<><br/><small>{row.error_code}</small></>}</td><td>{row.credits} · {row.charge_status}</td><td>{!row.deleted_at&&['COMPLETED','FAILED'].includes(row.state)&&<><button disabled={busy} onClick={()=>control(row,row.enabled?'disable':'enable')}>{row.enabled?'Nonaktifkan':'Aktifkan'}</button><button disabled={busy} onClick={()=>control(row,'delete')}>Hapus</button></>}</td></tr>)}</tbody></table>{rows.length===0&&<p>Tidak ada template.</p>}</div>}
    <div><button disabled={loading||offset===0} onClick={()=>setOffset(v=>Math.max(0,v-50))}>Sebelumnya</button><button disabled={loading||rows.length<50} onClick={()=>setOffset(v=>v+50)}>Berikutnya</button></div>
  </section>
}

import React, { useEffect, useState } from 'react'
import { getGenerationApiRoutes, saveGenerationApiRoute } from '../../api.js'
import '../../subscription.css'

function RouteForm({ route, onSaved }) {
  const [enabled, setEnabled] = useState(route.enabled), [model, setModel] = useState(route.model), [key, setKey] = useState(''), [clear, setClear] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const save = async event => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    try {
      const result = await saveGenerationApiRoute(route.lane, { enabled, model, ...(key ? { api_key: key } : {}), clear_key: clear, confirm: true })
      setKey(''); setClear(false); setNotice('Pengaturan disimpan. Tidak ada generate berbayar yang dijalankan.'); onSaved(result)
    } catch (e) { setError(e.message || 'Pengaturan belum dapat disimpan.') } finally { setBusy(false) }
  }
  return <form className="admin-card generation-api-form" onSubmit={save}>
    <h2>{route.lane === 'fast' ? 'Fast · 9Router / OpenAI' : 'Standard · 9Router / Codex'}</h2>
    <p>{route.credits} AI Credit/hasil · kualitas Low · {route.ready ? 'Siap digunakan' : route.configured ? 'Dinonaktifkan' : 'Belum terhubung'}</p>
    <label>Model<input placeholder={route.lane === 'fast' ? 'openai/gpt-image-2.5-flare' : 'cx/gpt-image-2.5'} value={model} onChange={e => setModel(e.target.value)} required maxLength={128} /></label>
    <label>Key 9Router baru<input type="password" autoComplete="new-password" value={key} onChange={e => setKey(e.target.value)} placeholder={route.configured ? 'Kosongkan untuk mempertahankan key' : 'Masukkan key di sini'} /></label>
    <label className="generation-api-toggle"><input type="checkbox" checked={clear} onChange={e => setClear(e.target.checked)} />Hapus key tersimpan</label>
    <label className="generation-api-toggle"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />Aktifkan jalur</label>
    <p className="admin-muted">Key disimpan terenkripsi dan tidak ditampilkan kembali. Tidak ada fallback otomatis antarjalur. Kedua jalur memakai alamat 9Router dari server. Fast memakai key Standard/server jika tidak diberi key 9Router sendiri. Key OpenAI lama pada Fast diabaikan; akun OpenAI dikelola di dashboard 9Router.</p>
    <button type="submit" disabled={busy || !model || Boolean(key && clear)}>{busy ? 'Menyimpan…' : 'Simpan jalur'}</button>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </form>
}
export default function GenerationApiRoutes() {
  const [routes, setRoutes] = useState(null), [error, setError] = useState(''), [revision, setRevision] = useState(0)
  useEffect(() => { let active = true; getGenerationApiRoutes().then(data => { if (active) setRoutes(data.routes) }).catch(e => { if (active) setError(e.status === 404 ? 'Aturan subscription v2 belum diaktifkan pada server ini.' : e.message) }); return () => { active = false } }, [revision])
  return <section><h2>Jalur API Generate</h2><p>Pengaturan produksi terpisah dari AI Provider Lab. Hanya Superadmin yang dapat mengubah jalur.</p>
    {error && <><p role="alert">{error}</p><button type="button" onClick={() => { setError(''); setRevision(v => v + 1) }}>Coba lagi</button></>}
    {!routes && !error && <p role="status">Memuat pengaturan…</p>}
    {routes?.map(route => <RouteForm key={route.lane} route={route} onSaved={saved => setRoutes(rows => rows.map(row => row.lane === saved.lane ? saved : row))} />)}
  </section>
}

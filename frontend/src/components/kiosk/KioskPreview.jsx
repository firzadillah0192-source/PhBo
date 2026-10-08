import React, { useEffect, useRef, useState } from 'react'
import './kiosk-preview.css'

const modes = [
  { id: 'CLASSIC', name: 'Classic', tagline: 'Pose. Smile. Repeat.', description: 'Tiga momen kecil, satu cerita. Pilih pose terbaikmu untuk photo strip.', format: '2 strip pada 1 lembar 4R', shots: 3, icon: 'strip' },
  { id: 'BASIC', name: 'Basic', tagline: 'Your photo, a new look.', description: 'Satu foto personal dengan desain pilihan untuk dibawa pulang.', format: '1 foto · desain template', shots: 1, icon: 'portrait' },
  { id: 'ADVANCED', name: 'Advanced', tagline: 'Step into another world.', description: 'Ubah satu pose menjadi pengalaman foto dengan tema pilihanmu.', format: '1 foto · hasil 4R', shots: 1, icon: 'world' },
]

function CameraIcon() {
  return <svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="M10 20h12l4-6h12l4 6h12v30H10z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/><circle cx="32" cy="35" r="10" stroke="currentColor" strokeWidth="2"/><circle cx="47" cy="26" r="2" fill="currentColor"/></svg>
}
function ModeArt({ type }) {
  return <div className={`kv-art kv-art-${type}`} aria-hidden="true"><div className="kv-art-glow"/>{type === 'strip' ? <div className="kv-strips">{[0,1].map(n=><div className="kv-strip" key={n}><i/><i/><i/><small>NXBOOTH</small></div>)}</div> : <div className="kv-portrait"><div className="kv-silhouette"/><div className="kv-orbit"/><span>{type === 'world' ? '✦' : '✳'}</span></div>}</div>
}

export default function KioskPreview() {
  const [mode, setMode] = useState('CLASSIC')
  const [stage, setStage] = useState('choose')
  const [photos, setPhotos] = useState([])
  const [operator, setOperator] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const urls = useRef(new Set())
  const input = useRef(null)
  const choice = modes.find(m => m.id === mode)
  const current = stage === 'choose' ? 0 : stage === 'capture' ? 1 : 2
  useEffect(() => { document.title = 'NXBooth — Kiosk preview'; return () => { for (const url of urls.current) URL.revokeObjectURL(url) } }, [])
  function reset() {
    for (const url of urls.current) URL.revokeObjectURL(url)
    urls.current.clear(); setPhotos([]); setStage('choose'); setError('')
  }
  async function choosePhotos(event) {
    const files = Array.from(event.target.files || []); event.target.value = ''
    if (!files.length || loading) return
    setError('')
    if (files.length > choice.shots - photos.length) { setError(`Pilih maksimal ${choice.shots - photos.length} foto lagi.`); return }
    setLoading(true)
    const pending = []
    try {
      for (const file of files) {
        if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 12 * 1024 * 1024) throw new Error('Pilih foto JPEG atau PNG, maksimal 12 MB per foto.')
        const url = URL.createObjectURL(file); urls.current.add(url); pending.push({url})
        const image = new Image()
        await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('Foto tidak dapat dibaca. Pilih JPEG atau PNG yang valid.')); image.src = url })
        if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 40000000) throw new Error('Resolusi foto terlalu besar. Pilih foto hingga 40 megapixel.')
      }
      setPhotos(previous => [...previous, ...pending])
    } catch (e) {
      for (const p of pending) { URL.revokeObjectURL(p.url); urls.current.delete(p.url) }
      setError(e.message)
    } finally { setLoading(false) }
  }
  function retake(index) {
    const photo = photos[index]; URL.revokeObjectURL(photo.url); urls.current.delete(photo.url)
    setPhotos(previous => previous.filter((_, i) => i !== index)); setStage('capture'); setError('')
  }
  async function fullscreen() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen() }
    catch { setError('Browser ini tidak menyediakan mode layar penuh.') }
  }
  return <div className="kv-app">
    <header className="kv-header"><a className="kv-logo" href="/" aria-label="NXBooth beranda">NX<span>Booth</span><sup>EVENT STATION</sup></a><div className="kv-header-actions"><span className="kv-preview-dot">Preview web</span><button className="kv-icon-button" aria-label="Operator" onClick={() => setOperator(!operator)} aria-expanded={operator} aria-controls="kv-operator">☷ <span>Operator</span></button></div></header>
    <main className="kv-main" id="kiosk-main">
      <div className="kv-topline"><span className="kv-eyebrow">YOUR MOMENT STARTS HERE</span><nav aria-label="Tahap sesi" className="kv-steps">{['Pilih mode','Foto','Review'].map((label,i)=><span key={label} className={i === current ? 'is-current' : i < current ? 'is-done' : ''} aria-current={i === current ? 'step' : undefined}><b>{i < current ? '✓' : i + 1}</b>{label}</span>)}</nav></div>
      {error && <div className="kv-error" role="alert">{error}</div>}
      {stage === 'choose' ? <>
        <div className="kv-intro"><div><h1>A little pose.<br/>A lasting <em>memory.</em></h1><p>Pilih pengalamanmu. Buat momen ini jadi sesuatu<br className="kv-desktop-break"/> yang bisa kamu bawa pulang.</p></div><div className="kv-session-note"><span>✦</span><p>One session.<br/><strong>All yours.</strong></p></div></div>
        <div className="kv-mode-grid">{modes.map(item => <button key={item.id} className={`kv-mode-card ${mode === item.id ? 'is-selected' : ''}`} onClick={() => setMode(item.id)} aria-pressed={mode === item.id}>
          <ModeArt type={item.icon}/><div className="kv-card-body"><div className="kv-card-heading"><h2>{item.name}</h2><span className="kv-radio"/></div><span className="kv-tagline">{item.tagline}</span><p>{item.description}</p><div className="kv-card-footer"><span>{item.shots} {item.shots > 1 ? 'poses' : 'pose'}</span><span>{item.format}</span></div></div>
        </button>)}</div>
        <div className="kv-bottom-action"><p><span aria-hidden="true">✧</span> Tidak perlu terburu-buru. Pilih yang paling kamu suka.</p><button className="kv-primary" onClick={() => setStage('capture')}>Mulai {choice.name} <span aria-hidden="true">→</span></button></div>
      </> : <>
        <div className="kv-stage-heading"><div><span className="kv-mode-label">{choice.name} / {choice.shots} {choice.shots > 1 ? 'poses' : 'pose'}</span><h1>{stage === 'capture' ? 'Ready for your close-up?' : 'Looking good.'}</h1><p>{stage === 'capture' ? 'Pilih foto dari perangkat untuk mencoba tampilan sesi.' : 'Periksa foto pilihanmu. Kamu bisa mengganti pose sebelum lanjut.'}</p></div><button className="kv-secondary" disabled={loading} onClick={reset}>← Ganti mode</button></div>
        <div className="kv-capture-layout"><div className="kv-camera-area">{stage === 'review' && photos.length ? <div className={`kv-review-grid ${mode === 'CLASSIC' ? 'is-strip' : ''}`}>{photos.map((photo,i)=><figure key={photo.url}><img src={photo.url} alt={`Pose ${i + 1}`}/><figcaption>POSE {String(i + 1).padStart(2,'0')}<button onClick={() => retake(i)}>Ganti foto {i + 1}</button></figcaption></figure>)}</div> : <div className="kv-camera-placeholder"><div className="kv-camera-corners"/><CameraIcon/><h2>Area kamera</h2><p>Preview menggunakan foto dari perangkat.<br/>Live view kamera belum aktif.</p><span className="kv-camera-indicator"><i/> CAMERA PREVIEW</span></div>}</div>
          <aside className="kv-session-sidebar"><span className="kv-eyebrow">SESI KAMU</span><h2>{choice.name}</h2><p>{choice.tagline}</p><div className="kv-photo-slots">{Array.from({length:choice.shots},(_,i)=><div key={i} className={photos[i] ? 'is-filled' : ''}>{photos[i] ? <img src={photos[i].url} alt={`Thumbnail pose ${i + 1}`}/> : <span>{String(i + 1).padStart(2,'0')}</span>}</div>)}</div><p className="kv-photo-count">{photos.length} dari {choice.shots} foto dipilih</p>
          <input ref={input} type="file" accept="image/jpeg,image/png" multiple={choice.shots > 1} onChange={choosePhotos} aria-label="Pilih foto preview" className="kv-file-input" disabled={loading || photos.length === choice.shots}/>
          {stage === 'capture' && <><button className="kv-primary" disabled={loading || photos.length === choice.shots} onClick={() => input.current.click()}>{loading ? 'Memeriksa foto…' : 'Pilih foto'} <span aria-hidden="true">＋</span></button><button className="kv-secondary" disabled={loading || photos.length !== choice.shots} onClick={() => setStage('review')}>Review foto →</button></>}
          {stage === 'review' && <><button className="kv-primary" disabled>Proses foto</button><p className="kv-preview-explanation">Generation belum dihubungkan pada preview ini. Foto pilihanmu tidak dikirim ke server.</p><button className="kv-secondary" onClick={reset}>Sesi baru</button></>}
          <div className="kv-format-note"><span>FORMAT</span><strong>{choice.format}</strong><small>Layout dan cetak fisik belum divalidasi.</small></div></aside></div>
      </>}
      <div className="kv-preview-banner"><span>PREVIEW</span><p>Ini tampilan awal kiosk. Foto hanya ditampilkan di browser; kamera USB, generation, dan printer belum aktif di halaman ini.</p></div>
    </main>
    <footer className="kv-footer"><span>MADE FOR MOMENTS, MADE FOR YOU.</span><span>NXBooth <i>✦</i> Event experience</span></footer>
    {operator && <div className="kv-operator" id="kv-operator" role="dialog" aria-label="Panel operator preview"><div><h2>Panel operator <small>PREVIEW</small></h2><button onClick={() => setOperator(false)} aria-label="Tutup panel operator">×</button></div><p>Panel ini memperlihatkan status fitur, tanpa menyimpan konfigurasi atau credential.</p><dl><dt>Kamera USB Canon</dt><dd>Belum terhubung</dd><dt>Printer Windows</dt><dd>Belum terhubung</dd><dt>Generation</dt><dd>Belum diaktifkan di preview</dd></dl><button className="kv-secondary" onClick={fullscreen}>Layar penuh</button><button className="kv-secondary" disabled={loading} onClick={() => { reset(); setOperator(false) }}>Reset preview</button></div>}
  </div>
}

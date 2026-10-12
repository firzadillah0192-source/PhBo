import React, { useEffect, useState } from 'react'
import StudioModal from './StudioModal.jsx'
import { CatalogImage } from '../home/ModeCards.jsx'
import { MODE_NAMES } from '../../creditCatalog.js'
import { templatePreview, experiencePreview } from './experienceCatalog.js'

export default function ModePickerModal({ mode, templates, experiences, layouts, selectedId, onSelect, loading, error, onRetry, onBack, onClose }) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(() => window.innerHeight <= 500 ? 3 : window.innerWidth <= 650 ? 2 : 6)
  useEffect(() => {
    const resize = () => { setPageSize(window.innerHeight <= 500 ? 3 : window.innerWidth <= 650 ? 2 : 6); setPage(0) }
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  const items = mode === 'CLASSIC' ? layouts : mode === 'BASIC' ? templates : experiences
  const query = search.trim().toLocaleLowerCase()
  const filtered = items.filter(item => `${item.name || ''} ${item.description || ''} ${item.category || ''}`.toLocaleLowerCase().includes(query))
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pages - 1)
  const visible = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
  const preview = item => mode === 'CLASSIC' ? item.preview_url : mode === 'BASIC' ? templatePreview(item) : experiencePreview(item)
  return <StudioModal title={MODE_NAMES[mode]} onBack={onBack} onClose={onClose} wide>
    <label className="studio-picker-search"><span>Cari {mode === 'ADVANCED' ? 'pengalaman' : 'template'}</span><input type="search" placeholder={mode === 'ADVANCED' ? 'Cari gaya atau pengalaman…' : 'Cari template…'} value={search} onChange={event => { setSearch(event.target.value); setPage(0) }} /></label>
    <p className="studio-picker-count" role="status">{loading ? 'Memuat pilihan…' : `${filtered.length} pilihan`}</p>
    {error ? <div className="customer-empty"><h2>Pilihan belum bisa dimuat.</h2><button type="button" className="customer-solid-button" onClick={onRetry}>Coba lagi</button></div> : loading ? <div className="studio-picker-loading" aria-busy="true">Menyiapkan pilihan untukmu…</div> : filtered.length ? <><div className="studio-picker-grid">{visible.map(item => <button type="button" className={`studio-picker-card ${selectedId === item.id ? 'is-selected' : ''}`} key={item.id} onClick={() => onSelect(item.id)} aria-pressed={selectedId === item.id}><span className="studio-picker-image"><CatalogImage src={preview(item)} alt={`Preview ${item.name}`} fallback="Preview belum tersedia" /></span><strong>{item.name}</strong><small>{item.description || (mode === 'CLASSIC' ? `${item.shot_count} foto dalam satu bingkai` : 'Pilih untuk melanjutkan')}</small></button>)}</div><nav className="studio-picker-pages" aria-label="Halaman pilihan"><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>← Sebelumnya</button><span role="status">{currentPage + 1} / {pages}</span><button type="button" disabled={currentPage + 1 === pages} onClick={() => setPage(currentPage + 1)}>Berikutnya →</button></nav></> : <div className="customer-empty"><h2>{query ? 'Tidak ada yang cocok.' : 'Belum ada pilihan tersedia.'}</h2><p>{query ? 'Coba kata lain atau kosongkan pencarian.' : 'Coba lagi sebentar.'}</p>{query && <button className="customer-outline-button" type="button" onClick={() => { setSearch(''); setPage(0) }}>Hapus pencarian</button>}</div>}
  </StudioModal>
}

import React, { useEffect, useState } from 'react'
import StudioModal from './StudioModal.jsx'
import { CatalogImage } from '../home/ModeCards.jsx'
import { MODE_NAMES } from '../../creditCatalog.js'
import { templatePreview, experiencePreview } from './experienceCatalog.js'
import { useT } from '../../i18n.js'

export default function ModePickerModal({ mode, templates, experiences, layouts, selectedId, onSelect, loading, error, onRetry, onBack, onClose }) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const t = useT()
  const sizeFor = () => window.innerHeight <= 500 ? 3 : window.innerWidth <= 650 ? 4 : window.innerWidth >= 1500 && window.innerHeight >= 800 ? 12 : window.innerWidth >= 1000 ? 8 : 6
  const [pageSize, setPageSize] = useState(sizeFor)
  useEffect(() => {
    const resize = () => { setPageSize(sizeFor()); setPage(0) }
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
  const kind = mode === 'ADVANCED' ? t('pengalaman', 'experience') : t('template', 'template')
  return <StudioModal title={MODE_NAMES[mode]} onBack={onBack} onClose={onClose} wide>
    <label className="studio-picker-search"><span>{t(`Cari ${kind}`, `Search ${kind}`)}</span><input type="search" placeholder={mode === 'ADVANCED' ? t('Cari gaya atau pengalaman…', 'Search styles or experiences…') : t('Cari template…', 'Search templates…')} value={search} onChange={event => { setSearch(event.target.value); setPage(0) }} /></label>
    <p className="studio-picker-count" role="status">{loading ? t('Memuat pilihan…', 'Loading choices…') : t(`${filtered.length} pilihan`, `${filtered.length} ${filtered.length === 1 ? 'choice' : 'choices'}`)}</p>
    {error ? <div className="customer-empty"><h2>{t('Pilihan belum bisa dimuat.', 'Choices could not be loaded.')}</h2><button type="button" className="customer-solid-button" onClick={onRetry}>{t('Coba lagi', 'Try again')}</button></div> : loading ? <div className="studio-picker-loading" aria-busy="true">{t('Menyiapkan pilihan untuk Anda…', 'Preparing your choices…')}</div> : filtered.length ? <><div className="studio-picker-grid">{visible.map(item => <button type="button" className={`studio-picker-card ${selectedId === item.id ? 'is-selected' : ''}`} key={item.id} onClick={() => onSelect(item.id)} aria-pressed={selectedId === item.id}><span className="studio-picker-image"><CatalogImage src={preview(item)} alt={t(`Pratinjau ${item.name}`, `Preview ${item.name}`)} fallback={t('Pratinjau belum tersedia', 'Preview not available yet')} /></span><strong>{item.name}</strong><small>{item.description || (mode === 'CLASSIC' ? t(`${item.shot_count} foto dalam satu bingkai`, `${item.shot_count} photos in one frame`) : t('Pilih untuk melanjutkan', 'Select to continue'))}</small></button>)}</div><nav className="studio-picker-pages" aria-label={t('Halaman pilihan', 'Choice pages')}><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>← {t('Sebelumnya', 'Previous')}</button><span role="status">{currentPage + 1} / {pages}</span><button type="button" disabled={currentPage + 1 === pages} onClick={() => setPage(currentPage + 1)}>{t('Berikutnya', 'Next')} →</button></nav></> : <div className="customer-empty"><h2>{query ? t('Tidak ada yang cocok.', 'Nothing matches.') : t('Belum ada pilihan tersedia.', 'No choices available yet.')}</h2><p>{query ? t('Coba kata lain atau kosongkan pencarian.', 'Try another word or clear the search.') : t('Coba lagi sebentar.', 'Try again in a moment.')}</p>{query && <button className="customer-outline-button" type="button" onClick={() => { setSearch(''); setPage(0) }}>{t('Hapus pencarian', 'Clear search')}</button>}</div>}
  </StudioModal>
}

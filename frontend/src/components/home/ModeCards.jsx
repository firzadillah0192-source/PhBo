import React, { useEffect, useState } from 'react'
import { modeRoute } from '../../customerRoute.js'
import { useLanguage, useT } from '../../i18n.js'

export const CREATION_MODES = [
  { id: 'CLASSIC', name: 'Photo Booth', title: 'Photo Booth', description: 'Multiple real camera shots composed into a traditional photobooth strip.', details: ['3 or 4 shots', 'No AI', 'Classic frames'], note: 'Real moments, together.' },
  { id: 'BASIC', name: 'Scene Remix', title: 'Scene Remix', description: 'Choose a designed world and bring your identity into the scene.', details: ['Curated templates', 'AI scene editing', 'Framed results'], note: 'A world, made for you.' },
  { id: 'ADVANCED', name: 'Creative Studio', title: 'Creative Studio', description: 'Choose an AI experience, visual frame style, and optional effects to create something unique.', details: ['AI experiences', 'Frame styles', 'Optional effects'], note: 'Make it one of a kind.' },
]

export function CatalogImage({ src, alt, loading = 'lazy', fallback }) {
  const t = useT()
  return <CatalogImageContent key={src || ''} src={src} alt={alt} loading={loading} fallback={fallback ?? t('Pratinjau segera hadir', 'Preview coming soon')} />
}

function CatalogImageContent({ src, alt, loading, fallback }) {
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!src || !failed || attempt !== 0) return
    const timer = setTimeout(() => { setAttempt(1); setFailed(false) }, 750)
    return () => clearTimeout(timer)
  }, [src, failed, attempt])
  return src && !failed
    ? <img key={attempt} src={src} alt={alt} loading={loading} decoding="async" onError={() => setFailed(true)} />
    : <span className="landing-image-fallback">{fallback}</span>
}

// Indonesian copy for the three modes; CREATION_MODES above stays the English source.
const MODE_COPY_ID = {
  CLASSIC: { description: 'Beberapa foto kamera asli disusun menjadi strip photobooth tradisional.', details: ['3 atau 4 foto', 'Tanpa AI', 'Bingkai klasik'], note: 'Momen nyata, bersama.' },
  BASIC: { description: 'Pilih dunia yang sudah dirancang dan bawa identitas Anda ke dalam adegannya.', details: ['Template pilihan', 'Edit adegan AI', 'Hasil berbingkai'], note: 'Dunia yang dibuat untuk Anda.' },
  ADVANCED: { description: 'Pilih pengalaman AI, gaya bingkai visual, dan efek opsional untuk menciptakan sesuatu yang unik.', details: ['Pengalaman AI', 'Gaya bingkai', 'Efek opsional'], note: 'Buat jadi satu-satunya.' },
}

export function localizedMode(mode, language) {
  return language === 'en' ? mode : { ...mode, ...MODE_COPY_ID[mode.id] }
}

export default function ModeCards({ previews = {}, onSelect, chooser = false, modeIds }) {
  const t = useT()
  const language = useLanguage()
  return <div className={`landing-mode-grid ${chooser ? 'is-chooser' : ''}`}>
    {CREATION_MODES.filter(mode => !modeIds || modeIds.includes(mode.id)).map((base, index) => { const mode = localizedMode(base, language); return <article className={`landing-mode-card mode-${mode.id.toLowerCase()}`} key={mode.id}>
      <div className="landing-mode-image">
        <CatalogImage key={previews[mode.id]} src={previews[mode.id]} alt={t(`Pratinjau ${mode.title}`, `${mode.title} preview`)} fallback={mode.note} />
        <span className="landing-mode-number" aria-hidden="true">0{index + 1}</span>
      </div>
      <div className="landing-mode-copy">
        <p className="landing-eyebrow">{mode.name}</p>
        <h3>{mode.title}</h3>
        <p>{mode.description}</p>
        <ul>{mode.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>
        <a href={modeRoute(mode.id)} onClick={(event) => {
          if (onSelect && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) {
            event.preventDefault()
            onSelect(mode.id)
          }
        }}>{chooser ? t(`Pilih ${mode.name}`, `Choose ${mode.name}`) : t(`Jelajahi ${mode.name}`, `Explore ${mode.name}`)} <span aria-hidden="true">↗</span></a>
      </div>
    </article> })}
  </div>
}

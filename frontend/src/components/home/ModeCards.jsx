import React, { useState } from 'react'
import { modeRoute } from '../../customerRoute.js'

export const CREATION_MODES = [
  { id: 'CLASSIC', name: 'Photo Booth', title: 'Photo Booth', description: 'Multiple real camera shots composed into a traditional photobooth strip.', details: ['3 or 4 shots', 'No AI', 'Classic frames'], note: 'Real moments, together.' },
  { id: 'BASIC', name: 'Scene Remix', title: 'Scene Remix', description: 'Choose a designed world and bring your identity into the scene.', details: ['Curated templates', 'AI scene editing', 'Framed results'], note: 'A world, made for you.' },
  { id: 'ADVANCED', name: 'Creative Studio', title: 'Creative Studio', description: 'Choose an AI experience, visual frame style, and optional effects to create something unique.', details: ['AI experiences', 'Frame styles', 'Optional effects'], note: 'Make it one of a kind.' },
]

export function CatalogImage({ src, alt, loading = 'lazy', fallback = 'Preview coming soon' }) {
  const [failed, setFailed] = useState(false)
  return src && !failed
    ? <img src={src} alt={alt} loading={loading} decoding="async" onError={() => setFailed(true)} />
    : <span className="landing-image-fallback">{fallback}</span>
}

export default function ModeCards({ previews = {}, onSelect, chooser = false, modeIds }) {
  return <div className={`landing-mode-grid ${chooser ? 'is-chooser' : ''}`}>
    {CREATION_MODES.filter(mode => !modeIds || modeIds.includes(mode.id)).map((mode, index) => <article className={`landing-mode-card mode-${mode.id.toLowerCase()}`} key={mode.id}>
      <div className="landing-mode-image">
        <CatalogImage key={previews[mode.id]} src={previews[mode.id]} alt={`${mode.title} preview`} fallback={mode.note} />
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
        }}>{chooser ? `Choose ${mode.name}` : `Explore ${mode.name}`} <span aria-hidden="true">↗</span></a>
      </div>
    </article>)}
  </div>
}

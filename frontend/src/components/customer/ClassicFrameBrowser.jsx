import React, { useState } from 'react'
import { classicThemes, layoutsForTheme } from './classicThemes.js'
import './classicFrames.css'

export default function ClassicFrameBrowser({ layouts, selectedId, onSelect }) {
  const [theme, setTheme] = useState('all')
  const themes = classicThemes(layouts)
  const visible = layoutsForTheme(layouts, theme)
  function selectTheme(slug) {
    setTheme(slug)
  }
  return <section className="gallery-page classic-browser customer-stage-enter">
    <header className="gallery-heading"><p className="customer-kicker">Traditional photobooth</p><h1>Choose your frame.</h1><p>Find a frame for your celebration. Capture 3 or 4 real photographs.</p></header>
    <nav className="classic-theme-list" aria-label="Frame themes">
      {[{ slug: 'all', name: 'All frames', count: layouts.length }, ...themes].map((item) => <button key={item.slug} type="button" aria-pressed={theme === item.slug} onClick={() => selectTheme(item.slug)}>{item.name}<small>{item.count}</small></button>)}
    </nav>
    <p className="classic-frame-count" aria-live="polite">{theme === 'all' ? 'All celebrations' : themes.find((item) => item.slug === theme)?.name} · {visible.length} frames</p>
    <div className="classic-layout-grid">{visible.map((item) => <button key={item.id} type="button" className={`classic-layout-card ${selectedId === item.id ? 'is-selected' : ''}`} aria-pressed={selectedId === item.id} onClick={() => onSelect(item.id)}><img src={item.preview_url} alt={`${item.name} frame preview`} loading="lazy" decoding="async" /><span><strong>{item.name}</strong><small>{item.shot_count} Photos</small></span><em>{item.theme_name || 'Classic Originals'}</em></button>)}</div>
    {!visible.length && <div className="template-empty">No Classic frames are available.</div>}
  </section>
}

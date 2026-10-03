import React, { useEffect, useRef, useState } from 'react'
import { experienceCopy, experiencePreview, experienceSections, templatePreview } from './experienceCatalog.js'
import ClassicFrameBrowser from './ClassicFrameBrowser.jsx'

function useRevealOnIntersect() {
  const cardRef = useRef(null)
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    const node = cardRef.current
    if (!node) return undefined
    if (typeof IntersectionObserver === 'undefined') {
      setRevealed(true)
      return undefined
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setRevealed(true)
        observer.disconnect()
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return [cardRef, revealed]
}

function LookCard({ item, index, selected, onSelect }) {
  const [line, group] = experienceCopy(item)
  const [cardRef, revealed] = useRevealOnIntersect()
  const preview = experiencePreview(item)
  return (
    <button
      ref={cardRef}
      type="button"
      className={`look-card ${revealed ? 'is-revealed ' : ''}${selected ? 'is-selected' : ''}`}
      style={{ '--card-index': index }}
      aria-pressed={selected}
      onClick={() => onSelect(item.id)}
    >
      <span className="look-card-media">
        {preview ? <img src={preview} alt={`${item.name} creative preview`} loading={index < 6 ? 'eager' : 'lazy'} decoding="async" /> : <span className="look-card-placeholder" aria-label={`${item.name} preview unavailable`}><small>Approved preview</small><strong>{item.name}</strong><em>Preview coming soon</em></span>}
        <i aria-hidden="true" />
        <small>{group}</small>
        {selected && <span className="look-card-selection" aria-hidden="true">Selected</span>}
        <b aria-hidden="true">{selected ? '✓' : '↗'}</b>
      </span>
      <span className="look-card-caption"><span><strong>{item.name}</strong><em>{group} · {line}</em></span><i aria-hidden="true">{selected ? 'Selected' : 'Enter world'}</i></span>
    </button>
  )
}

function LoadingCatalog() {
  return (
    <section className="gallery-page advanced-browser customer-stage-enter" aria-live="polite" aria-busy="true">
      <header className="gallery-heading">
        <p className="customer-kicker">AI worlds</p>
        <h1>Choose your world.</h1>
        <p>Loading creative experiences.</p>
      </header>
      <section className="customer-empty">
        <p className="customer-kicker">Preparing the gallery</p>
        <h2>One moment.</h2>
      </section>
    </section>
  )
}

function EmptyCatalog({ onRetry }) {
  return (
    <section className="customer-empty">
      <p className="customer-kicker">Studio unavailable</p>
      <h1>We couldn't load the studio.</h1>
      <button className="customer-solid-button" onClick={onRetry}>Try again</button>
    </section>
  )
}

export default function ExperienceBrowser({ mode, templates, experiences, layouts = [], selectedId, onSelect, onContinue, catalogError, catalogLoading, onRetry }) {
  if (catalogError) return <EmptyCatalog onRetry={onRetry} />

  if (catalogLoading) return <LoadingCatalog />

  if (mode === 'CLASSIC') {
    return <ClassicFrameBrowser layouts={layouts} selectedId={selectedId} onSelect={onSelect} onContinue={onContinue} />
  }

  if (mode === 'BASIC') {
    return (
      <section className="gallery-page basic-browser customer-stage-enter">
        <header className="gallery-heading">
          <p className="customer-kicker">Curated studio</p>
          <h1>Choose your studio.</h1>
          <p>Choose a polished, dependable finish for your portrait.</p>
        </header>
        {templates.length ? <div className="template-gallery" data-count={Math.min(templates.length, 4)}>
          {templates.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`template-card ${selectedId === item.id ? 'is-selected' : ''}`}
              aria-pressed={selectedId === item.id}
              onClick={() => onSelect(item.id)}
            >
              <span className="template-card-media">
                {templatePreview(item) ? <img src={templatePreview(item)} alt={`${item.name} studio preview`} loading="lazy" decoding="async" /> : <span className="template-preview-placeholder"><small>Marketing preview</small><strong>Preview coming soon</strong><em>Curated by Photobooth AI</em></span>}
                <i aria-hidden="true" />
                <small>Curated studio</small>
                <b aria-hidden="true">{selectedId === item.id ? '✓' : '＋'}</b>
              </span>
              <span className="template-card-caption"><span><strong>{item.name}</strong><em>{item.description || 'Instant studio portrait · no AI credit'}</em></span><i aria-hidden="true">{selectedId === item.id ? 'Selected' : 'Select'}</i></span>
            </button>
          ))}
        </div> : <div className="template-empty"><strong>No studios are available right now.</strong><span>Please check back shortly.</span></div>}
        <SelectionDock label={templates.find((item) => item.id === selectedId)?.name || 'Choose a studio'} onContinue={onContinue} disabled={!selectedId} />
      </section>
    )
  }

  if (!experiences.length) {
    return (
      <section className="gallery-page advanced-browser customer-stage-enter">
        <header className="gallery-heading">
          <p className="customer-kicker">AI worlds</p>
          <h1>Choose your world.</h1>
          <p>New creative experiences are being prepared.</p>
        </header>
        <section className="customer-empty" aria-live="polite">
          <p className="customer-kicker">No worlds published yet</p>
          <h2>Check back shortly.</h2>
          <p>There are no Advanced experiences available right now.</p>
          <button className="customer-solid-button" onClick={onRetry}>Try again</button>
        </section>
      </section>
    )
  }

  const sections = experienceSections(experiences)
  let cardOffset = 0
  const renderedSections = sections.map((section) => {
    const offset = cardOffset
    cardOffset += section.items.length
    return { ...section, offset }
  })
  return (
    <section className="gallery-page advanced-browser customer-stage-enter">
      <header className="gallery-heading">
        <p className="customer-kicker">AI worlds</p>
        <h1>Choose your world.</h1>
        <p>Start with an atmosphere. Your photograph remains the hero.</p>
      </header>

      {renderedSections.map(({ group, items, offset }) => (
        <section className="experience-collection" key={group}>
          <header><div><p>Explore</p><h2>{group}</h2></div><span>{items.length} {items.length === 1 ? 'world' : 'worlds'}</span></header>
          <div className="experience-gallery">
            {items.map((item, index) => <LookCard key={item.id} item={item} index={offset + index} selected={selectedId === item.id} onSelect={onSelect} />)}
          </div>
        </section>
      ))}

      <SelectionDock label={experiences.find((item) => item.id === selectedId)?.name || 'Choose a world'} selectionLabel="Selected world" onContinue={onContinue} disabled={!selectedId} continueLabel="Choose frame style" />
    </section>
  )
}

function SelectionDock({ label, selectionLabel = 'Selected', onContinue, disabled, continueLabel = 'Continue to photo' }) {
  return (
    <div className="selection-dock">
      <span aria-live="polite"><small>{disabled ? 'Next step' : selectionLabel}</small><strong>{label}</strong></span>
      <button className="customer-solid-button" disabled={disabled} onClick={onContinue}>{continueLabel} <b>→</b></button>
    </div>
  )
}

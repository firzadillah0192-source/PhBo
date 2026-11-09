import React from 'react'
import { EXPERIENCE_GROUPS, experienceCopy, experienceGroup, experiencePreview, templatePreview } from './experienceCatalog.js'

function LookCard({ item, selected, hero = false, onSelect }) {
  const [line, group] = experienceCopy(item)
  return (
    <button
      type="button"
      className={`look-card ${hero ? 'is-hero ' : ''}${selected ? 'is-selected' : ''}`}
      aria-pressed={selected}
      onClick={() => onSelect(item.id)}
    >
      <span className="look-card-media">
        {experiencePreview(item) ? <img src={experiencePreview(item)} alt={`${item.name} creative preview`} loading={hero ? 'eager' : 'lazy'} decoding="async" /> : <span className="look-card-placeholder">Preview coming soon</span>}
        <i aria-hidden="true" />
        <small>{group}</small>
        <b aria-hidden="true">{selected ? '✓' : '↗'}</b>
        {hero && <span className="look-card-hero-copy"><em>Featured world</em><strong>{item.name}</strong><span>{line}</span></span>}
      </span>
      {!hero && <span className="look-card-caption"><span><strong>{item.name}</strong><em>{line}</em></span><i aria-hidden="true">Enter world</i></span>}
    </button>
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

export default function ExperienceBrowser({ mode, templates, experiences, selectedId, onSelect, onContinue, catalogError, onRetry }) {
  if (catalogError) return <EmptyCatalog onRetry={onRetry} />

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

  const featured = experiences.slice(0, 5)
  const featuredIds = new Set(featured.map((item) => item.id))
  const hero = featured[0]
  const supporting = featured.slice(1)
  const groups = [...new Set(experiences.filter((item) => !featuredIds.has(item.id)).map(experienceGroup))]
  const orderedGroups = [...EXPERIENCE_GROUPS.filter((group) => groups.includes(group)), ...groups.filter((group) => !EXPERIENCE_GROUPS.includes(group))]

  return (
    <section className="gallery-page advanced-browser customer-stage-enter">
      <header className="gallery-heading">
        <p className="customer-kicker">AI worlds</p>
        <h1>Choose your world.</h1>
        <p>Start with an atmosphere. Your photograph remains the hero.</p>
      </header>

      {hero && (
        <section className="featured-gallery" aria-label="Featured worlds">
          <LookCard item={hero} hero selected={selectedId === hero.id} onSelect={onSelect} />
          <div>{supporting.map((item) => <LookCard key={item.id} item={item} selected={selectedId === item.id} onSelect={onSelect} />)}</div>
        </section>
      )}

      {orderedGroups.map((group) => {
        const items = experiences.filter((item) => !featuredIds.has(item.id) && experienceGroup(item) === group)
        if (!items.length) return null
        return (
          <section className="world-collection" key={group}>
            <header><div><p>Explore</p><h2>{group}</h2></div><span>Drag to discover →</span></header>
            <div className="world-rail">{items.map((item) => <LookCard key={item.id} item={item} selected={selectedId === item.id} onSelect={onSelect} />)}</div>
          </section>
        )
      })}

      <SelectionDock label={experiences.find((item) => item.id === selectedId)?.name || 'Choose a world'} onContinue={onContinue} disabled={!selectedId} />
    </section>
  )
}

function SelectionDock({ label, onContinue, disabled }) {
  return (
    <div className="selection-dock">
      <span><small>Selected</small><strong>{label}</strong></span>
      <button className="customer-solid-button" disabled={disabled} onClick={onContinue}>Continue to photo <b>→</b></button>
    </div>
  )
}

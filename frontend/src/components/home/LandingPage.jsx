import React from 'react'
import ModeCards, { CatalogImage } from './ModeCards.jsx'
import { featuredPreviews, modePreviews } from './landingCatalog.js'
import { modeRoute } from '../../customerRoute.js'
import './landing.css'

const STEPS = [
  ['Capture', 'Take a photo or upload one.'],
  ['Choose', 'Pick a photobooth experience.'],
  ['Create', 'NXBooth creates the final portrait.'],
  ['Take it home', 'Download, share, or scan the QR. Save it for printing.'],
]

function Actions() {
  return <div className="landing-actions">
    <a className="landing-primary" href="/create">Try NXBooth Free <span aria-hidden="true">↗</span></a>
    <a className="landing-secondary" href="#experiences">Explore Experiences <span aria-hidden="true">↓</span></a>
  </div>
}

export default function LandingPage({ templates = [], experiences = [], layouts = [], loading = false, error = false, onRetry }) {
  const featured = featuredPreviews(experiences, templates)
  const hero = featured[0]
  const second = featured.find((item) => item.mode === 'BASIC' && item.id !== hero?.id) || featured[1]
  return <div className="nx-landing">
    <main>
      <section className="landing-hero landing-container" aria-labelledby="landing-title">
        <div className="landing-hero-copy">
          <p className="landing-eyebrow">A moment worth keeping</p>
          <h1 id="landing-title">Moments, made<br /><em>extraordinary.</em></h1>
          <p className="landing-intro">Capture a moment, choose a world, and take home something entirely your own.</p>
          <Actions />
          <p className="landing-hero-note">Your camera. Your imagination. Your keepsake.</p>
        </div>
        <div className="landing-hero-art">
          <div className="landing-scenery" aria-hidden="true" />
          {hero && <figure className="landing-hero-print print-main">
            <CatalogImage key={hero.preview} src={hero.preview} alt={`${hero.name} experience preview`} loading="eager" />
            <figcaption><span>{hero.name}</span><small>NXBooth</small></figcaption>
          </figure>}
          {second && <figure className="landing-hero-print print-second">
            <CatalogImage key={second.preview} src={second.preview} alt={`${second.name} experience preview`} loading="eager" />
            <figcaption>{second.name}</figcaption>
          </figure>}
          <p className="landing-art-caption">Your moment.<br /><em>A new perspective.</em></p>
          <span className="landing-art-index" aria-hidden="true">THE NXBOOTH EXPERIENCE / 01</span>
        </div>
      </section>

      <section id="how-it-works" className="landing-how landing-container landing-section" aria-labelledby="how-title">
        <div className="landing-section-heading"><p className="landing-eyebrow">How it works</p><h2 id="how-title">A little imagination.<br />Four simple steps.</h2></div>
        <ol className="landing-steps">{STEPS.map(([title, copy], index) => <li key={title}>
          <span aria-hidden="true">0{index + 1}</span><h3>{title}</h3><p>{copy}</p>
        </li>)}</ol>
      </section>

      <section id="modes" className="landing-modes landing-section" aria-labelledby="modes-title">
        <div className="landing-container">
          <div className="landing-section-heading"><p className="landing-eyebrow">Three ways to create</p><h2 id="modes-title">Same moment.<br />Different possibilities.</h2><p>Keep it real, step into a designed world, or follow your imagination.</p></div>
          <ModeCards previews={modePreviews({ templates, experiences, layouts })} />
        </div>
      </section>

      <section id="experiences" className="landing-featured landing-container landing-section" aria-labelledby="featured-title">
        <div className="landing-section-heading landing-heading-row"><div><p className="landing-eyebrow">Find your world</p><h2 id="featured-title">Featured Experiences</h2></div><a className="landing-text-link" href={modeRoute('ADVANCED')}>Explore all experiences <span aria-hidden="true">→</span></a></div>
        {loading && !featured.length ? <p className="landing-catalog-state" role="status">Opening the preview collection…</p> : featured.length ? <ul className="landing-featured-grid" aria-label="Published experience previews">
          {featured.map((item) => <li key={`${item.mode}:${item.id}`}><a className="landing-experience-card" href={modeRoute(item.mode)}>
            <div><CatalogImage key={item.preview} src={item.preview} alt={`${item.name} preview`} /><span aria-hidden="true">↗</span></div>
            <p>{item.caption}</p><h3>{item.name}</h3>
          </a></li>)}
        </ul> : <div className="landing-catalog-state"><p>{error ? 'The preview collection is taking a moment to load.' : 'New worlds are being prepared. Explore the studio to see what’s available.'}</p>{error && <button type="button" onClick={onRetry}>Reload previews <span aria-hidden="true">↗</span></button>}</div>}
      </section>

      <section className="landing-output landing-section" aria-labelledby="output-title">
        <div className="landing-container landing-output-inner">
          <div><p className="landing-eyebrow">More than a portrait</p><h2 id="output-title">Made to leave<br /><em>the screen.</em></h2><p>Download your creation instantly, share it with someone, or open it on your phone with QR. Keep a print-ready file for your own printer.</p></div>
          <ul className="landing-output-list">
            <li><span>01</span><strong>Print</strong><p>A keepsake for your connected printer.</p></li>
            <li><span>02</span><strong>Download</strong><p>Your creation, ready to save.</p></li>
            <li><span>03</span><strong>QR</strong><p>Scan and open on your phone.</p></li>
            <li><span>04</span><strong>Share</strong><p>Send a moment worth talking about.</p></li>
          </ul>
        </div>
      </section>

      <section className="landing-final landing-container landing-section" aria-labelledby="final-title">
        <p className="landing-eyebrow">Step into something new</p><h2 id="final-title">Ready for your<br /><em>next look?</em></h2><Actions />
      </section>
    </main>
    <footer className="landing-footer landing-container">
      <div><a className="landing-footer-brand" href="/">NXBooth</a><p>Powered by GenNexByte</p></div>
      <nav aria-label="NXBooth footer"><a href="#experiences">Experiences</a><a href="#how-it-works">How It Works</a><a href="/create">Start creating <span aria-hidden="true">↗</span></a></nav>
      <small>Make a moment your own.</small>
    </footer>
  </div>
}

import React from 'react'
import ModeCards from './ModeCards.jsx'
import { modePreviews } from './landingCatalog.js'
import { MODE_NAMES } from '../../creditCatalog.js'
import { modeRoute } from '../../customerRoute.js'
import './landing.css'

export default function CreationChooser({ templates, experiences, layouts, onSelect, savedFlow }) {
  const canResume = ['CLASSIC', 'BASIC', 'ADVANCED'].includes(savedFlow?.mode) && savedFlow?.uploadId
  return <main id="studio-main" className="creation-chooser landing-container" tabIndex="-1">
    <div className="studio-breadcrumb"><a className="studio-back" href="/"><span aria-hidden="true">←</span> Back to home</a><span>Studio / choose your mode</span></div>
    <header>
      <p className="landing-eyebrow">Your moment starts here</p>
      <h1>Choose how you want to create.</h1>
      <p>A classic photo strip, a curated world, or something entirely new.</p>
    </header>
    {canResume && <p className="creation-resume">Already started? <a href={modeRoute(savedFlow.mode)}>Resume your {MODE_NAMES[savedFlow.mode]} creation <span aria-hidden="true">→</span></a></p>}
    <ModeCards previews={modePreviews({ templates, experiences, layouts })} onSelect={onSelect} chooser />
    <p className="creation-footnote">Choose a mode to explore. No sign-in needed to get started.</p>
  </main>
}

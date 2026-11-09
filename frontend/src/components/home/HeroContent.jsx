import React from 'react'
import ModeSelector from './ModeSelector.jsx'

export default function HeroContent({ activeMode, pendingMode, onPreview, onLeave, onSelect }) {
  return (
    <main className="campaign-copy">
      <p className="campaign-kicker">Living editorial photo studio</p>
      <h1>Step into<br /><em>another you.</em></h1>
      <p className="campaign-intro">A portrait experience shaped by photography, character, and motion.</p>
      <ModeSelector activeMode={activeMode} pendingMode={pendingMode} onPreview={onPreview} onLeave={onLeave} onSelect={onSelect} />
    </main>
  )
}

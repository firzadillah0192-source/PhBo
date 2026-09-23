import React, { useEffect, useRef, useState } from 'react'
import HeroContent from './HeroContent.jsx'
import './home.css'

export default function CinematicHero({ onSelect, onHoverMode }) {
  const [activeMode, setActiveMode] = useState(null)
  const [pendingMode, setPendingMode] = useState(null)
  const timer = useRef(null)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const preview = (mode) => {
    if (pendingMode) return
    setActiveMode(mode)
    onHoverMode?.(mode)
  }

  const leave = () => {
    if (pendingMode) return
    setActiveMode(null)
    onHoverMode?.(null)
  }

  const select = (mode) => {
    if (pendingMode) return
    setActiveMode(mode)
    setPendingMode(mode)
    onHoverMode?.(mode)
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    timer.current = window.setTimeout(() => onSelect(mode), reduced ? 30 : 520)
  }

  return (
    <section className={`campaign-hero ${pendingMode ? 'is-leaving' : ''}`} aria-label="Choose your Photobooth AI studio">
      <HeroContent activeMode={activeMode} pendingMode={pendingMode} onPreview={preview} onLeave={leave} onSelect={select} />
      <span className="campaign-index" aria-hidden="true">Celestial living studio · 2026</span>
      <span className="campaign-scroll" aria-hidden="true"><i />A living portrait world</span>
    </section>
  )
}

import React, { useEffect, useRef, useState } from 'react'
import { CatalogImage } from './ModeCards.jsx'

// An animated editorial preview, using only art returned by the public catalog.
// It never captures a photo or starts a customer generation.
export default function LandingReel({ previews = [] }) {
  const root = useRef(null)
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [reduced, setReduced] = useState(false)
  const [visible, setVisible] = useState(true)
  const item = previews[index % Math.max(1, previews.length)]
  const running = !paused && !reduced && visible

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    let inView = true
    const update = () => setReduced(preference.matches)
    const visibility = () => setVisible(inView && !document.hidden)
    update()
    preference.addEventListener('change', update)
    document.addEventListener('visibilitychange', visibility)
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting
      visibility()
    }) : null
    if (root.current) observer?.observe(root.current)
    return () => {
      preference.removeEventListener('change', update)
      document.removeEventListener('visibilitychange', visibility)
      observer?.disconnect()
    }
  }, [])

  useEffect(() => {
    if (!running || previews.length < 2) return undefined
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % previews.length), 6000)
    return () => window.clearInterval(timer)
  }, [running, previews.length])

  return <div ref={root} className={`landing-reel ${running ? 'is-playing' : 'is-paused'}`} role="region" aria-label="Animated experience preview">
    <div className="landing-reel-stage" key={item ? `${item.mode}:${item.id}` : 'empty'}>
      <div className="landing-reel-flash" aria-hidden="true" />
      <div className="landing-reel-viewfinder" aria-hidden="true"><i /><i /><i /><i /></div>
      {item && <figure className="landing-reel-photo">
        <CatalogImage key={item.preview} src={item.preview} alt={`${item.name} experience preview`} loading="eager" />
        <figcaption><span>{item.name}</span><small>NXBooth</small></figcaption>
      </figure>}
      <div className="landing-reel-progress" aria-hidden="true"><span /></div>
    </div>
    <div className="landing-reel-controls">
      <span><i aria-hidden="true" /> Experience preview <small>{String((index % Math.max(1, previews.length)) + 1).padStart(2, '0')} / {String(previews.length).padStart(2, '0')}</small></span>
      <button type="button" aria-label={paused ? 'Play experience animation' : 'Pause experience animation'} onClick={() => setPaused((value) => !value)} disabled={reduced || !item}>{paused || reduced ? 'Play' : 'Pause'} <span aria-hidden="true">{paused || reduced ? '▷' : 'Ⅱ'}</span></button>
    </div>
  </div>
}

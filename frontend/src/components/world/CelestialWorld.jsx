import React, { useEffect, useRef } from 'react'
import { experiencePreview, templatePreview } from '../customer/experienceCatalog.js'

const KEYS = [
  { t: 0, scale: 1.48, x: 0, y: 24, fog: .82, clouds: 1, emerge: .06, estate: 0, island: 0, detail: .08 },
  { t: .15, scale: 1.28, x: -15, y: 8, fog: .36, clouds: .46, emerge: 1, estate: .18, island: 0, detail: .3 },
  { t: .34, scale: 1.08, x: 3, y: 0, fog: .1, clouds: .1, emerge: .15, estate: 1, island: .08, detail: 1 },
  { t: .55, scale: .98, x: 15, y: -9, fog: .12, clouds: .14, emerge: 0, estate: .62, island: .6, detail: .52 },
  { t: .73, scale: .86, x: 4, y: -20, fog: .22, clouds: .3, emerge: 0, estate: .08, island: 1, detail: .12 },
  { t: .88, scale: 1.2, x: 2, y: 10, fog: .64, clouds: .9, emerge: .08, estate: .05, island: .24, detail: .08 },
  { t: 1, scale: 1.48, x: 0, y: 24, fog: .82, clouds: 1, emerge: .06, estate: 0, island: 0, detail: .08 },
]

const REST = KEYS[2]
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const lerp = (a, b, amount) => a + (b - a) * amount
const smooth = (value) => value * value * (3 - 2 * value)

function sample(time) {
  const wrapped = ((time % 1) + 1) % 1
  let index = 0
  while (index < KEYS.length - 1 && KEYS[index + 1].t < wrapped) index += 1
  const from = KEYS[index]
  const to = KEYS[index + 1]
  const amount = smooth(clamp((wrapped - from.t) / (to.t - from.t || 1), 0, 1))
  return Object.fromEntries(Object.keys(from).map((key) => [key, lerp(from[key], to[key], amount)]))
}

function blend(from, to, amount) {
  return Object.fromEntries(Object.keys(from).map((key) => [key, lerp(from[key], to[key], amount)]))
}

function worldTravel(mood, mode) {
  if (mood === 'home') return 1
  if (mood === 'gallery' && mode === 'BASIC') return .08
  if (mood === 'gallery') return .12
  if (mood === 'account') return .05
  if (mood === 'processing') return .26
  if (mood === 'result') return .14
  return .18
}

export default function CelestialWorld({ mood, mode, hoverMode, templates = [], experiences = [] }) {
  const rootRef = useRef(null)
  const rigRef = useRef(null)
  const moodRef = useRef(mood)
  const modeRef = useRef(mode)
  moodRef.current = mood
  modeRef.current = mode

  useEffect(() => {
    const root = rootRef.current
    const rig = rigRef.current
    if (!root || !rig) return undefined
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const mobile = window.matchMedia?.('(max-width: 700px)')
    if (reduced?.matches || mobile?.matches) {
      // Keep decorative full-screen compositing static on mobile/reduced-motion devices.
      rig.style.transform = 'translate3d(0, 0, 0) scale(1.03)'
      root.style.setProperty('--world-fog', REST.fog)
      root.style.setProperty('--world-clouds', REST.clouds)
      root.style.setProperty('--world-emerge', REST.emerge)
      root.style.setProperty('--world-estate', REST.estate)
      root.style.setProperty('--world-island', REST.island)
      root.style.setProperty('--world-detail', REST.detail)
      return undefined
    }
    const target = { x: 0, y: 0 }
    const pointer = { x: 0, y: 0 }
    let frame = 0
    const started = performance.now()

    const onPointer = (event) => {
      target.x = event.clientX / Math.max(window.innerWidth, 1) - .5
      target.y = event.clientY / Math.max(window.innerHeight, 1) - .5
    }
    const tick = (now) => {
      pointer.x += (target.x - pointer.x) * .035
      pointer.y += (target.y - pointer.y) * .035
      
      const travel = worldTravel(moodRef.current, modeRef.current)
      const pose = travel ? blend(REST, sample((now - started) / 18000), travel) : { ...REST, scale: 1.06, x: 0, y: 0, fog: .16 }
      const galleryMotion = moodRef.current === 'gallery'
      const accountMotion = moodRef.current === 'account'
      const quietMotion = galleryMotion || accountMotion
      const x = pose.x + pointer.x * (quietMotion ? (accountMotion ? 2 : 4) : 14 + travel * 12)
      const y = pose.y + pointer.y * (quietMotion ? (accountMotion ? 1.5 : 3) : 9 + travel * 8)
      rig.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${pose.scale})`
      root.style.setProperty('--world-fog', pose.fog)
      root.style.setProperty('--world-clouds', pose.clouds)
      root.style.setProperty('--world-emerge', pose.emerge)
      root.style.setProperty('--world-estate', pose.estate)
      root.style.setProperty('--world-island', pose.island)
      root.style.setProperty('--world-detail', pose.detail)
      frame = requestAnimationFrame(tick)
    }
    window.addEventListener('pointermove', onPointer, { passive: true })
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onPointer)
    }
  }, [])

  const approvedExperienceImages = experiences.map(experiencePreview).filter(Boolean).slice(0, 3)
  const installations = mode === 'ADVANCED' && mood !== 'home'
    ? approvedExperienceImages
    : mode === 'BASIC' && mood !== 'home'
      ? templates.map(templatePreview).filter(Boolean).slice(0, 3)
      : [
        '/celestial/experiences/cinematic-hero.webp',
        '/celestial/experiences/fantasy-portrait.webp',
        '/celestial/experiences/classic-booth.webp',
      ]

  return (
    <div ref={rootRef} className="celestial-world" data-mood={mood} data-mode={mode || undefined} data-hover={hoverMode || undefined} aria-hidden="true">
      <div ref={rigRef} className="celestial-rig">
        <div className="celestial-layer celestial-sky" />
        <div className="celestial-plate celestial-island" />
        <div className="celestial-layer celestial-garden" />
        <div className="celestial-plate celestial-estate" />
        <div className="celestial-plate celestial-emerge" />
        <div className="celestial-plate celestial-cloud-plate" />
        <div className="celestial-cloud cloud-one" />
        <div className="celestial-cloud cloud-two" />
        <div className="celestial-cloud cloud-three" />
        <div className="celestial-layer celestial-architecture" />
        <div className="celestial-layer celestial-waterfall" />
        <div className="celestial-falls" />
        {installations.map((image, index) => <figure className={`celestial-print celestial-print-${index + 1}`} key={`${image}-${index}`}><img src={image} alt="" /></figure>)}
        <div className="celestial-light" />
        <div className="celestial-fog" />
        <div className="celestial-mist" />
      </div>
    </div>
  )
}

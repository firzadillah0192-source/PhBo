import React, { useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import PhotoPanel from './PhotoPanel.jsx'

const DESKTOP_SLOTS = [
  { position: [-5.05, 2.28, -1.8], rotation: [-0.04, 0.29, -0.07], scale: 1.18, aspect: 'portrait' },
  { position: [4.8, 2.42, -2.9], rotation: [0.03, -0.25, 0.055], scale: 1.02, aspect: 'portrait' },
  { position: [-5.75, -0.25, 0.05], rotation: [0.02, 0.34, 0.025], scale: 1.22, aspect: 'landscape' },
  { position: [5.68, -0.18, -0.15], rotation: [-0.02, -0.34, -0.035], scale: 1.17, aspect: 'square' },
  { position: [-4.18, -2.78, -2.15], rotation: [0.06, 0.24, 0.08], scale: 0.94, aspect: 'portrait' },
  { position: [4.16, -2.7, -1.4], rotation: [0.04, -0.23, -0.055], scale: 0.98, aspect: 'landscape' },
  { position: [-1.92, 3.72, -4.75], rotation: [-0.03, 0.08, -0.03], scale: 0.78, aspect: 'landscape' },
  { position: [1.82, -3.72, -4.35], rotation: [0.04, -0.08, 0.04], scale: 0.76, aspect: 'portrait' },
  { position: [2.2, 3.58, -5.25], rotation: [-0.05, -0.1, 0.04], scale: 0.68, aspect: 'square' },
]

const TABLET_SLOTS = [
  { position: [-3.75, 2.5, -2.2], rotation: [-0.03, 0.24, -0.07], scale: 1.02, aspect: 'portrait' },
  { position: [3.68, 2.34, -2.85], rotation: [0.02, -0.23, 0.05], scale: 0.92, aspect: 'portrait' },
  { position: [-4.2, -0.65, -0.2], rotation: [0.02, 0.3, 0.03], scale: 1, aspect: 'landscape' },
  { position: [4.24, -0.58, -0.55], rotation: [-0.01, -0.31, -0.03], scale: 0.98, aspect: 'square' },
  { position: [-2.72, -3.05, -3.1], rotation: [0.04, 0.16, 0.06], scale: 0.78, aspect: 'portrait' },
  { position: [2.72, -3.05, -2.7], rotation: [0.04, -0.16, -0.05], scale: 0.78, aspect: 'landscape' },
]

const MOBILE_SLOTS = [
  { position: [-2.42, 2.8, -2.75], rotation: [-0.02, 0.2, -0.065], scale: 0.92, aspect: 'portrait' },
  { position: [2.42, 2.6, -3.2], rotation: [0.02, -0.2, 0.055], scale: 0.82, aspect: 'portrait' },
  { position: [-2.58, -2.8, -2.25], rotation: [0.02, 0.2, 0.05], scale: 0.82, aspect: 'square' },
  { position: [2.5, -2.72, -2.9], rotation: [0.03, -0.2, -0.045], scale: 0.8, aspect: 'landscape' },
]

export default function PhotoField({ items, activeMode, pendingMode, reducedMotion }) {
  const { size } = useThree()
  const slots = useMemo(() => {
    if (size.width < 640) return MOBILE_SLOTS
    if (size.width < 1050) return TABLET_SLOTS
    return DESKTOP_SLOTS
  }, [size.width])

  return slots.map((slot, index) => (
    <PhotoPanel
      key={`${items[index % items.length].panelId}-${slots.length}`}
      item={items[index % items.length]}
      slot={slot}
      index={index}
      activeMode={activeMode}
      pendingMode={pendingMode}
      reducedMotion={reducedMotion}
    />
  ))
}

import React, { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import PhotoField from './PhotoField.jsx'
import CameraRig from './CameraRig.jsx'
import StudioLighting from './StudioLighting.jsx'

export default function PhotoStudioScene({ items, activeMode, pendingMode, reducedMotion, onReady }) {
  const invalidate = useThree((state) => state.invalidate)

  useEffect(() => {
    invalidate()
  }, [activeMode, pendingMode, reducedMotion, invalidate])

  useEffect(() => {
    onReady?.()
  }, [onReady])

  return (
    <>
      <color attach="background" args={['#f7f7f5']} />
      <fog attach="fog" args={['#f7f7f5', 9.5, 19]} />
      <CameraRig reducedMotion={reducedMotion} />
      <StudioLighting activeMode={activeMode} reducedMotion={reducedMotion} />
      <PhotoField
        items={items}
        activeMode={activeMode}
        pendingMode={pendingMode}
        reducedMotion={reducedMotion}
      />
      <mesh position={[0, 0, -6.4]}>
        <planeGeometry args={[26, 15]} />
        <meshStandardMaterial color="#ececea" roughness={0.9} metalness={0.02} />
      </mesh>
    </>
  )
}

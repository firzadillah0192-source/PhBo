import React, { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

export default function StudioLighting({ activeMode, reducedMotion }) {
  const keyLight = useRef(null)
  const rimLight = useRef(null)
  const { size } = useThree()

  useFrame((state, delta) => {
    const pointerScale = reducedMotion || size.width < 768 ? 0 : 0.7
    const t = state.clock.elapsedTime
    const lightTravel = reducedMotion ? 0 : Math.sin(t * 0.34) * 2.1
    const lightLift = reducedMotion ? 0 : Math.cos(t * 0.27 + 0.8) * 0.65

    if (keyLight.current) {
      keyLight.current.position.x = THREE.MathUtils.damp(
        keyLight.current.position.x,
        -1.4 + lightTravel + state.pointer.x * pointerScale,
        1.5,
        delta,
      )
      keyLight.current.position.y = THREE.MathUtils.damp(
        keyLight.current.position.y,
        4.8 + lightLift,
        1.5,
        delta,
      )
      keyLight.current.intensity = THREE.MathUtils.damp(
        keyLight.current.intensity,
        (activeMode === 'BASIC' ? 4.8 : 4.4) + (reducedMotion ? 0 : Math.sin(t * 0.42) * 0.35),
        2.2,
        delta,
      )
    }
    if (rimLight.current) {
      rimLight.current.position.x = THREE.MathUtils.damp(
        rimLight.current.position.x,
        3.5 - lightTravel * 0.6,
        1.3,
        delta,
      )
      rimLight.current.intensity = THREE.MathUtils.damp(
        rimLight.current.intensity,
        activeMode === 'ADVANCED' ? 3.5 : 3.05,
        2.2,
        delta,
      )
    }
  })

  return (
    <>
      <ambientLight intensity={1.35} color="#fffaf0" />
      <hemisphereLight intensity={1.1} color="#ffffff" groundColor="#c8c5be" />
      <spotLight
        ref={keyLight}
        position={[-1.4, 4.8, 5.2]}
        intensity={4.4}
        angle={0.48}
        penumbra={0.92}
        decay={1.7}
        color="#fff8ed"
      />
      <spotLight
        ref={rimLight}
        position={[3.5, 2.4, 1.8]}
        intensity={3.05}
        angle={0.56}
        penumbra={0.94}
        decay={1.9}
        color="#a9c9ff"
      />
      <pointLight position={[0, -3.8, 1.5]} intensity={1.05} color="#ded8ff" distance={9} />
    </>
  )
}

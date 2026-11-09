import React, { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import PhotoStudioScene from './PhotoStudioScene.jsx'

export default function WebGLStage({ items, activeMode, pendingMode, reducedMotion, onReady, onFailure }) {
  return (
    <Canvas
      className="home-webgl-canvas"
      dpr={reducedMotion ? 1 : [1, 1.6]}
      frameloop={reducedMotion ? 'demand' : 'always'}
      camera={{ position: [0, 0, 8.65], fov: 36, near: 0.1, far: 30 }}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping
        gl.toneMappingExposure = 1.18
        gl.domElement.addEventListener('webglcontextlost', (event) => {
          event.preventDefault()
          onFailure?.()
        }, { once: true })
      }}
      fallback={null}
    >
      <Suspense fallback={null}>
        <PhotoStudioScene
          items={items}
          activeMode={activeMode}
          pendingMode={pendingMode}
          reducedMotion={reducedMotion}
          onReady={onReady}
        />
      </Suspense>
    </Canvas>
  )
}

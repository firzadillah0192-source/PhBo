import React, { useEffect, useMemo, useRef } from 'react'
import { RoundedBox, useTexture } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

function ImageSurface({ image, width, height, opacityRef }) {
  const source = useTexture(image)
  const texture = useMemo(() => {
    const next = source.clone()
    const imageWidth = source.image?.naturalWidth || source.image?.width || 1
    const imageHeight = source.image?.naturalHeight || source.image?.height || 1
    const imageAspect = imageWidth / imageHeight
    const panelAspect = width / height

    next.colorSpace = THREE.SRGBColorSpace
    next.wrapS = THREE.ClampToEdgeWrapping
    next.wrapT = THREE.ClampToEdgeWrapping
    next.anisotropy = 4
    if (imageAspect > panelAspect) {
      next.repeat.set(panelAspect / imageAspect, 1)
      next.offset.set((1 - next.repeat.x) / 2, 0)
    } else {
      next.repeat.set(1, imageAspect / panelAspect)
      next.offset.set(0, (1 - next.repeat.y) / 2)
    }
    next.needsUpdate = true
    return next
  }, [source, width, height])

  useEffect(() => () => texture.dispose(), [texture])

  return (
    <mesh position={[0, 0, 0.043]}>
      <planeGeometry args={[width, height]} />
      <meshStandardMaterial
        ref={opacityRef}
        map={texture}
        roughness={0.42}
        metalness={0.02}
        emissive="#ffffff"
        emissiveIntensity={0.16}
        transparent
        toneMapped={false}
      />
    </mesh>
  )
}

function PlaceholderSurface({ mode, width, height, opacityRef }) {
  const accent = mode === 'BASIC' ? '#a9c9ff' : '#8d83ff'
  return (
    <group position={[0, 0, 0.043]}>
      <mesh>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial
          ref={opacityRef}
          color="#d9d8d5"
          roughness={0.72}
          metalness={0.08}
          transparent
        />
      </mesh>
      <mesh position={[-width * 0.12, height * 0.08, 0.002]}>
        <planeGeometry args={[width * 0.56, height * 0.72]} />
        <meshStandardMaterial color={accent} roughness={0.9} transparent opacity={0.7} />
      </mesh>
      <mesh position={[width * 0.23, -height * 0.25, 0.003]}>
        <planeGeometry args={[width * 0.28, height * 0.18]} />
        <meshStandardMaterial color="#ffffff" roughness={0.86} transparent opacity={0.62} />
      </mesh>
    </group>
  )
}

export default function PhotoPanel({ item, slot, index, activeMode, pendingMode, reducedMotion }) {
  const groupRef = useRef(null)
  const surfaceMaterial = useRef(null)
  const frameMaterial = useRef(null)
  const base = useMemo(() => ({
    position: new THREE.Vector3(...slot.position),
    rotation: new THREE.Euler(...slot.rotation),
    scale: slot.scale,
  }), [slot])

  useFrame((state, delta) => {
    const group = groupRef.current
    if (!group) return

    const focused = activeMode === item.mode
    const muted = Boolean(activeMode) && !focused
    const selected = pendingMode === item.mode
    const leaving = Boolean(pendingMode) && !selected
    const focusDepth = selected ? 0.72 : focused ? 0.32 : leaving ? -0.72 : muted ? -0.3 : 0
    const targetScale = base.scale * (selected ? 1.065 : leaving ? 0.93 : focused ? 1.025 : 1)
    const t = state.clock.elapsedTime
    const profile = 0.22 + (index % 4) * 0.035
    const depthFactor = Math.max(0.35, 1 - Math.abs(base.position.z) * 0.1)
    const driftX = reducedMotion ? 0 : Math.sin(t * profile + index * 1.73) * (0.2 + (index % 3) * 0.085) * depthFactor
    const driftY = reducedMotion ? 0 : Math.sin(t * (profile * 0.73) + index * 2.11) * (0.07 + (index % 2) * 0.05)
    const driftZ = reducedMotion ? 0 : Math.cos(t * (profile * 0.61) + index * 1.37) * (0.18 + (index % 3) * 0.075)
    const turn = reducedMotion ? 0 : Math.sin(t * (profile * 0.47) + index) * 0.018

    group.position.x = THREE.MathUtils.damp(group.position.x, base.position.x + driftX, 2.4, delta)
    group.position.y = THREE.MathUtils.damp(group.position.y, base.position.y + driftY, 2.4, delta)
    group.position.z = THREE.MathUtils.damp(group.position.z, base.position.z + focusDepth + driftZ, 2.8, delta)
    group.rotation.x = THREE.MathUtils.damp(group.rotation.x, base.rotation.x, 3.4, delta)
    group.rotation.y = THREE.MathUtils.damp(group.rotation.y, focused || selected ? base.rotation.y * 0.38 : base.rotation.y, 3.8, delta)
    group.rotation.z = THREE.MathUtils.damp(group.rotation.z, base.rotation.z + turn, 2.5, delta)
    group.scale.setScalar(THREE.MathUtils.damp(group.scale.x, targetScale, 3.8, delta))

    const opacity = leaving ? 0.28 : muted ? 0.52 : 1
    if (surfaceMaterial.current) surfaceMaterial.current.opacity = THREE.MathUtils.damp(surfaceMaterial.current.opacity, opacity, 4, delta)
    if (frameMaterial.current) frameMaterial.current.opacity = THREE.MathUtils.damp(frameMaterial.current.opacity, Math.max(0.38, opacity), 4, delta)
  })

  const width = slot.aspect === 'landscape' ? 1.72 : slot.aspect === 'square' ? 1.42 : 1.24
  const height = slot.aspect === 'landscape' ? 1.18 : slot.aspect === 'square' ? 1.42 : 1.66

  return (
    <group ref={groupRef} position={slot.position} rotation={slot.rotation} scale={slot.scale}>
      <RoundedBox args={[width + 0.075, height + 0.075, 0.075]} radius={0.026} smoothness={2}>
        <meshStandardMaterial
          ref={frameMaterial}
          color="#f8f7f3"
          metalness={0.38}
          roughness={0.22}
          transparent
        />
      </RoundedBox>
      {item.image
        ? <ImageSurface image={item.image} width={width} height={height} opacityRef={surfaceMaterial} />
        : <PlaceholderSurface mode={item.mode} width={width} height={height} opacityRef={surfaceMaterial} />}
      <mesh position={[0, 0, -0.044]}>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial color="#c9c8c4" roughness={0.7} metalness={0.18} />
      </mesh>
    </group>
  )
}

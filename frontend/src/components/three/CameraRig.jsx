import React, { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

export default function CameraRig({ reducedMotion }) {
  const { camera, size } = useThree()
  const lookTarget = useRef(new THREE.Vector3(0, 0, 0))

  useFrame((state, delta) => {
    const mobile = size.width < 768
    const pointerX = reducedMotion || mobile ? 0 : state.pointer.x
    const pointerY = reducedMotion || mobile ? 0 : state.pointer.y
    const elapsed = state.clock.elapsedTime
    // Offset waves form a seamless ~16 second camera pass. Pointer input
    // rides on top of the automatic movement instead of driving it.
    const cinematicX = reducedMotion ? 0 : Math.sin(elapsed * 0.39) * (mobile ? 0.08 : 0.32)
    const cinematicY = reducedMotion ? 0 : Math.sin(elapsed * 0.31 + 1.4) * (mobile ? 0.035 : 0.11)
    const cinematicZ = reducedMotion ? 0 : Math.sin(elapsed * 0.39 - 0.7) * (mobile ? 0.12 : 0.42)
    const baseZ = size.width < 640 ? 9.9 : size.width < 1050 ? 9.25 : 8.65
    const targetX = pointerX * (mobile ? 0 : 0.24) + cinematicX
    const targetY = pointerY * 0.11 + cinematicY
    const targetZ = baseZ + cinematicZ

    camera.position.x = THREE.MathUtils.damp(camera.position.x, targetX, 2.4, delta)
    camera.position.y = THREE.MathUtils.damp(camera.position.y, targetY, 2.4, delta)
    camera.position.z = THREE.MathUtils.damp(camera.position.z, targetZ, 2.8, delta)
    lookTarget.current.set(
      pointerX * 0.075 + cinematicX * 0.12,
      pointerY * 0.04 + cinematicY * 0.08,
      -0.28,
    )
    camera.lookAt(lookTarget.current)
  })

  return null
}

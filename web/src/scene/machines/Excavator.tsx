import * as THREE from 'three'
import { useRef } from 'react'
import { MAT, hazardMat } from '../materials'
import { Beacon, Box, Cyl, Decal, Track, spanBetween } from './parts'
import { useMachineDrive } from './common'

// Matches the twin: boom chord 5.7 m from a pivot 1.6 m ahead of the swing centre, stick 2.9 m at boom + stick - 1.1.
const BOOM_L = 5.7
const STICK_L = 2.9
const APEX_X = 3.0
const APEX_Y = 0.85
const SEG1_A = Math.atan2(APEX_Y, APEX_X)
const SEG1_L = Math.hypot(APEX_X, APEX_Y)
const SEG2_A = Math.atan2(-APEX_Y, BOOM_L - APEX_X)
const SEG2_L = Math.hypot(BOOM_L - APEX_X, APEX_Y)

export function Excavator({ id }: { id: string }) {
  const root = useRef<THREE.Group>(null!)
  const upper = useRef<THREE.Group>(null!)
  const boom = useRef<THREE.Group>(null!)
  const stick = useRef<THREE.Group>(null!)
  const bucket = useRef<THREE.Group>(null!)
  const soil = useRef<THREE.Mesh>(null!)
  const cylBoom = useRef<THREE.Mesh>(null!)
  const cylStick = useRef<THREE.Mesh>(null!)
  const cylBucket = useRef<THREE.Mesh>(null!)
  const aBoomBase = useRef<THREE.Object3D>(null!)
  const aBoomMid = useRef<THREE.Object3D>(null!)
  const aStickBase = useRef<THREE.Object3D>(null!)
  const aStickEnd = useRef<THREE.Object3D>(null!)
  const aBucketBase = useRef<THREE.Object3D>(null!)
  const aBucketEnd = useRef<THREE.Object3D>(null!)

  useMachineDrive(id, root, 4.8, 3.2, (m) => {
    const j = m.joints
    upper.current.rotation.y = j.swing ?? 0
    boom.current.rotation.z = j.boom ?? 0.3
    stick.current.rotation.z = (j.stick ?? 0.5) - 1.1
    bucket.current.rotation.z = -0.4 - (j.bucket ?? 0.3)
    soil.current.visible = m.load_t > 1
    spanBetween(cylBoom.current, aBoomBase.current, aBoomMid.current)
    spanBetween(cylStick.current, aStickBase.current, aStickEnd.current)
    spanBetween(cylBucket.current, aBucketBase.current, aBucketEnd.current)
  })

  return (
    <group ref={root}>
      <Track position={[0, 0.48, -1.3]} />
      <Track position={[0, 0.48, 1.3]} />
      <Box s={[2.4, 0.5, 2.0]} m={MAT.dark} position={[0, 0.9, 0]} />
      <Cyl r={0.9} h={0.3} m={MAT.dark} position={[0, 1.2, 0]} />
      <group ref={upper} position={[0, 1.35, 0]}>
        <Box s={[3.1, 1.15, 2.9]} r={0.22} position={[-0.55, 0.62, 0]} />
        <Box s={[1.1, 1.0, 2.88]} r={0.32} m={MAT.dark} position={[-2.0, 0.55, 0]} />
        <Decal text={id} w={1.5} h={0.75} rotation={[-Math.PI / 2, 0, -Math.PI / 2]} position={[-0.9, 1.205, 0.55]} />
        <Box s={[3.12, 0.05, 2.92]} m={MAT.accent} position={[-0.55, 0.2, 0]} shadow={false} />
        <mesh geometry={new THREE.PlaneGeometry(2.2, 0.28)} material={hazardMat()} position={[-2.56, 0.55, 0]} rotation={[0, -Math.PI / 2, 0]} />
        <group position={[0.35, 1.2, -0.85]}>
          <Box s={[1.6, 1.55, 1.05]} r={0.14} position={[0, 0.7, 0]} />
          <Box s={[1.62, 1.1, 1.07]} r={0.12} m={MAT.glass} position={[0.05, 0.85, 0]} shadow={false} />
          <Box s={[1.5, 0.08, 0.95]} m={MAT.dark} position={[0, 1.5, 0]} shadow={false} />
          <Beacon position={[-0.5, 1.6, 0.3]} />
        </group>
        <Cyl r={0.08} h={0.9} m={MAT.darkMatte} position={[-1.3, 1.6, 0.9]} />
        <object3D ref={aBoomBase} position={[0.9, 0.5, 0.35]} />
        <group ref={boom} position={[1.6, 0.95, 0.35]}>
          <group rotation={[0, 0, SEG1_A]}>
            <Box s={[SEG1_L + 0.3, 0.62, 0.62]} r={0.12} position={[SEG1_L / 2, 0, 0]} />
            <Box s={[SEG1_L, 0.04, 0.64]} m={MAT.accent} position={[SEG1_L / 2, 0.2, 0]} shadow={false} />
            <object3D ref={aBoomMid} position={[SEG1_L * 0.7, -0.35, 0]} />
          </group>
          <group position={[APEX_X, APEX_Y, 0]} rotation={[0, 0, SEG2_A]}>
            <Box s={[SEG2_L + 0.3, 0.56, 0.58]} r={0.12} position={[SEG2_L / 2, 0, 0]} />
            <object3D ref={aStickBase} position={[0.3, 0.4, 0]} />
          </group>
          <group ref={stick} position={[BOOM_L, 0, 0]}>
            <Box s={[STICK_L + 0.4, 0.42, 0.46]} r={0.1} m={MAT.paintDirty} position={[STICK_L / 2 - 0.1, 0, 0]} />
            <object3D ref={aStickEnd} position={[-0.3, 0.35, 0]} />
            <object3D ref={aBucketBase} position={[0.5, 0.3, 0]} />
            <group ref={bucket} position={[STICK_L, 0, 0]}>
              <object3D ref={aBucketEnd} position={[0.2, 0.45, 0]} />
              <Box s={[1.2, 0.18, 1.3]} r={0.05} m={MAT.darkMatte} position={[0.55, -0.55, 0]} rotation={[0, 0, -0.3]} />
              <Box s={[0.18, 1.1, 1.3]} r={0.05} m={MAT.darkMatte} position={[0.05, -0.05, 0]} />
              <Box s={[0.9, 0.8, 0.12]} r={0.04} m={MAT.darkMatte} position={[0.45, -0.15, 0.6]} />
              <Box s={[0.9, 0.8, 0.12]} r={0.04} m={MAT.darkMatte} position={[0.45, -0.15, -0.6]} />
              <mesh ref={soil} geometry={new THREE.SphereGeometry(0.6, 10, 8)} material={MAT.soil} position={[0.5, -0.1, 0]} scale={[1, 0.6, 1.05]} />
            </group>
          </group>
        </group>
        <mesh ref={cylBoom} geometry={new THREE.CylinderGeometry(0.11, 0.11, 1, 10)} material={MAT.steel} castShadow />
        <mesh ref={cylStick} geometry={new THREE.CylinderGeometry(0.1, 0.1, 1, 10)} material={MAT.steel} />
        <mesh ref={cylBucket} geometry={new THREE.CylinderGeometry(0.08, 0.08, 1, 10)} material={MAT.steel} />
      </group>
    </group>
  )
}

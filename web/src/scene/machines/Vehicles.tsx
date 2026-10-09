import * as THREE from 'three'
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { MAT, hazardMat } from '../materials'
import { Beacon, Box, Cyl, Decal, Track, Wheel } from './parts'
import { useMachineDrive } from './common'

const plane = (w: number, h: number) => new THREE.PlaneGeometry(w, h)

function Cab({ w = 1.5, h = 1.5, d = 1.3, ...rest }: { w?: number; h?: number; d?: number } & JSX.IntrinsicElements['group']) {
  return (
    <group {...rest}>
      <Box s={[w, h, d]} r={0.12} position={[0, h / 2, 0]} />
      <Box s={[w + 0.02, h * 0.6, d + 0.02]} r={0.1} m={MAT.glass} position={[0, h * 0.62, 0]} shadow={false} />
      <Box s={[w + 0.1, 0.1, d + 0.1]} r={0.04} m={MAT.dark} position={[0, h + 0.03, 0]} />
    </group>
  )
}

export function HaulTruck({ id }: { id: string }) {
  const root = useRef<THREE.Group>(null!)
  const rear = useRef<THREE.Group>(null!)
  const body = useRef<THREE.Group>(null!)
  const load = useRef<THREE.Mesh>(null!)
  const wheels = useRef<THREE.Group>(null!)
  useMachineDrive(id, root, 10, 2.9, (m, dt) => {
    body.current.rotation.z = (m.joints.body ?? m.joints.dump ?? m.joints.hoist ?? 0) * 0.9
    rear.current.rotation.y = -(m.joints.steer ?? m.joints.articulation ?? 0)
    load.current.visible = m.load_t > 2
    load.current.scale.y = Math.min(1, m.load_t / 24) * 0.9 + 0.1
    const spin = (m.speed * dt) / 0.8
    wheels.current.traverse((o) => {
      if (o.userData.wheel) o.rotation.z -= spin
    })
  })
  return (
    <group ref={root}>
      <group ref={wheels}>
        <group position={[3.2, 0, 0]}>
          <Box s={[2.6, 1.1, 2.3]} r={0.2} position={[0.2, 1.45, 0]} />
          <Box s={[1.4, 0.4, 2.0]} r={0.15} m={MAT.dark} position={[1.3, 1.0, 0]} />
          <Cab w={1.5} h={1.4} d={1.5} position={[-0.3, 2.0, 0]} />
          <Decal text={id} w={1.3} h={0.62} rotation={[-Math.PI / 2, 0, -Math.PI / 2]} position={[0.75, 2.01, 0]} />
          <Beacon position={[-0.6, 3.5, 0.5]} />
          <Wheel r={0.8} w={0.6} position={[0.6, 0.8, 1.15]} userData={{ wheel: 1 }} />
          <Wheel r={0.8} w={0.6} position={[0.6, 0.8, -1.15]} userData={{ wheel: 1 }} />
        </group>
        <Box s={[0.6, 0.6, 0.6]} m={MAT.dark} position={[1.6, 1.1, 0]} />
        <group ref={rear} position={[1.6, 0, 0]}>
          <Box s={[5.4, 0.45, 1.3]} r={0.1} m={MAT.dark} position={[-3.0, 1.0, 0]} />
          <Wheel r={0.8} w={0.6} position={[-2.6, 0.8, 1.15]} userData={{ wheel: 1 }} />
          <Wheel r={0.8} w={0.6} position={[-2.6, 0.8, -1.15]} userData={{ wheel: 1 }} />
          <Wheel r={0.8} w={0.6} position={[-4.4, 0.8, 1.15]} userData={{ wheel: 1 }} />
          <Wheel r={0.8} w={0.6} position={[-4.4, 0.8, -1.15]} userData={{ wheel: 1 }} />
          <group ref={body} position={[-5.7, 1.35, 0]}>
            <Box s={[5.6, 0.25, 2.8]} r={0.08} position={[2.8, 0.1, 0]} />
            <Box s={[5.6, 1.5, 0.14]} r={0.06} position={[2.8, 0.85, 1.35]} />
            <Box s={[5.6, 1.5, 0.14]} r={0.06} position={[2.8, 0.85, -1.35]} />
            <Box s={[0.18, 1.9, 2.8]} r={0.06} position={[5.55, 1.05, 0]} />
            <Box s={[5.62, 0.06, 0.16]} m={MAT.accent} position={[2.8, 1.62, 1.36]} shadow={false} />
            <Box s={[5.62, 0.06, 0.16]} m={MAT.accent} position={[2.8, 1.62, -1.36]} shadow={false} />
            <mesh geometry={plane(2.6, 0.3)} material={hazardMat()} position={[-0.01, 0.6, 0]} rotation={[0, -Math.PI / 2, 0]} />
            <mesh ref={load} geometry={new THREE.SphereGeometry(1, 12, 8)} material={MAT.soil} position={[2.7, 1.1, 0]} scale={[2.6, 0.9, 1.25]} castShadow />
          </group>
        </group>
      </group>
    </group>
  )
}

export function Dozer({ id }: { id: string }) {
  const root = useRef<THREE.Group>(null!)
  const blade = useRef<THREE.Group>(null!)
  useMachineDrive(id, root, 4.2, 3.2, (m) => {
    blade.current.position.y = 0.55 + (m.joints.blade ?? 0) * 0.6
  })
  return (
    <group ref={root}>
      <Track len={3.6} position={[0, 0.48, -1.2]} />
      <Track len={3.6} position={[0, 0.48, 1.2]} />
      <Box s={[3.2, 1.2, 1.9]} r={0.2} position={[0.1, 1.4, 0]} />
      <Box s={[1.4, 0.06, 1.92]} m={MAT.accent} position={[0.8, 1.4, 0]} shadow={false} />
      <Decal text={id} w={1.2} h={0.6} rotation={[-Math.PI / 2, 0, -Math.PI / 2]} position={[0.9, 2.01, 0]} />
      <Cab w={1.4} h={1.4} d={1.5} position={[-0.8, 2.0, 0]} />
      <Beacon position={[-1.2, 3.5, 0.5]} />
      <Cyl r={0.08} h={0.9} m={MAT.darkMatte} position={[0.6, 2.4, -0.6]} />
      <group ref={blade} position={[2.25, 0.55, 0]}>
        <Box s={[0.35, 1.25, 3.9]} r={0.08} m={MAT.paintDirty} rotation={[0, 0, 0.15]} />
        <Box s={[1.5, 0.22, 0.22]} m={MAT.dark} position={[-0.8, 0.3, 1.2]} />
        <Box s={[1.5, 0.22, 0.22]} m={MAT.dark} position={[-0.8, 0.3, -1.2]} />
      </group>
      <Box s={[0.9, 0.2, 0.3]} m={MAT.dark} position={[-2.0, 0.9, 0]} />
    </group>
  )
}

export function Roller({ id }: { id: string }) {
  const root = useRef<THREE.Group>(null!)
  const drum = useRef<THREE.Mesh>(null!)
  useMachineDrive(id, root, 5.5, 2.3, (m) => {
    drum.current.rotation.y = -(m.joints.drum ?? 0)
  })
  return (
    <group ref={root}>
      <group position={[1.8, 0.75, 0]}>
        <mesh ref={drum} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.75, 0.75, 2.1, 22]} />
          <meshStandardMaterial color="#9aa1a8" roughness={0.4} metalness={0.7} />
        </mesh>
        <Box s={[1.7, 0.4, 2.3]} r={0.1} position={[0, 0.75, 0]} />
      </group>
      <Box s={[2.8, 1.3, 1.9]} r={0.25} position={[-0.8, 1.25, 0]} />
      <Decal text={id} w={1.1} h={0.55} rotation={[-Math.PI / 2, 0, -Math.PI / 2]} position={[-0.3, 1.91, 0]} />
      <Box s={[2.82, 0.06, 1.92]} m={MAT.accent} position={[-0.8, 0.95, 0]} shadow={false} />
      <Wheel r={0.75} w={0.55} position={[-1.3, 0.75, 1.0]} />
      <Wheel r={0.75} w={0.55} position={[-1.3, 0.75, -1.0]} />
      <group position={[-0.4, 1.9, 0]}>
        <Cyl r={0.06} h={1.6} m={MAT.dark} position={[0.5, 0.8, 0.8]} />
        <Cyl r={0.06} h={1.6} m={MAT.dark} position={[0.5, 0.8, -0.8]} />
        <Cyl r={0.06} h={1.6} m={MAT.dark} position={[-0.5, 0.8, 0.8]} />
        <Cyl r={0.06} h={1.6} m={MAT.dark} position={[-0.5, 0.8, -0.8]} />
        <Box s={[1.3, 0.08, 1.8]} m={MAT.paint} position={[0, 1.6, 0]} />
        <Beacon position={[0, 1.72, 0]} />
      </group>
    </group>
  )
}

export function Telehandler({ id }: { id: string }) {
  const root = useRef<THREE.Group>(null!)
  const boom = useRef<THREE.Group>(null!)
  const ext = useRef<THREE.Group>(null!)
  useMachineDrive(id, root, 5, 2.4, (m) => {
    boom.current.rotation.z = m.joints.boom ?? 0.2
    ext.current.position.x = 4.2 + (m.joints.extend ?? 0.3) * 3
  })
  return (
    <group ref={root}>
      <Box s={[4.6, 0.9, 1.8]} r={0.2} position={[0, 1.15, 0]} />
      <Decal text={id} w={1.1} h={0.55} rotation={[-Math.PI / 2, 0, -Math.PI / 2]} position={[-1.3, 1.61, 0.35]} />
      <Box s={[4.62, 0.06, 1.82]} m={MAT.accent} position={[0, 0.8, 0]} shadow={false} />
      {[1.5, -1.5].map((x) => [1.05, -1.05].map((z) => <Wheel key={`${x}${z}`} r={0.62} w={0.5} position={[x, 0.62, z]} />))}
      <Cab w={1.6} h={1.6} d={0.95} position={[0.3, 1.6, -0.75]} />
      <Beacon position={[0.3, 3.32, -0.75]} />
      <group ref={boom} position={[-1.8, 1.9, 0.35]}>
        <Box s={[4.6, 0.5, 0.5]} r={0.1} position={[2.3, 0, 0]} />
        <group ref={ext} position={[4.2, 0, 0]}>
          <Box s={[3.2, 0.38, 0.38]} r={0.08} m={MAT.paintDirty} position={[-1.2, 0, 0]} />
          <Box s={[0.12, 1.1, 1.3]} m={MAT.dark} position={[0.4, -0.3, 0]} />
          <Box s={[1.2, 0.08, 0.14]} m={MAT.steel} position={[1.0, -0.82, 0.4]} />
          <Box s={[1.2, 0.08, 0.14]} m={MAT.steel} position={[1.0, -0.82, -0.4]} />
        </group>
      </group>
    </group>
  )
}

export function PilingRig({ id }: { id: string }) {
  const root = useRef<THREE.Group>(null!)
  const auger = useRef<THREE.Group>(null!)
  useMachineDrive(id, root, 5.2, 3.6, (m) => {
    auger.current.rotation.y = m.joints.auger ?? 0
    auger.current.position.y = 1.2 + Math.max(0, 8 - (m.joints.depth ?? 4)) * 0.4
  })
  return (
    <group ref={root}>
      <Track len={5.2} position={[0, 0.5, -1.4]} />
      <Track len={5.2} position={[0, 0.5, 1.4]} />
      <Box s={[4.2, 1.4, 3.0]} r={0.25} position={[-0.8, 1.8, 0]} />
      <Decal text={id} w={1.4} h={0.7} rotation={[-Math.PI / 2, 0, -Math.PI / 2]} position={[-1.5, 2.51, 0]} />
      <Box s={[4.22, 0.06, 3.02]} m={MAT.accent} position={[-0.8, 1.15, 0]} shadow={false} />
      <Cab w={1.4} h={1.5} d={1.1} position={[0.9, 2.5, -0.9]} />
      <Box s={[1.2, 1.2, 2.9]} r={0.25} m={MAT.dark} position={[-2.7, 1.8, 0]} />
      <group position={[2.0, 1.2, 0]}>
        <Box s={[0.7, 24, 0.7]} r={0.1} position={[0, 12, 0]} />
        <Box s={[0.72, 24, 0.12]} m={hazardMat()} position={[0, 12, 0.37]} shadow={false} />
        <Box s={[1.4, 1.2, 1.2]} r={0.15} m={MAT.dark} position={[0, 24.2, 0]} />
        <Cyl r={0.12} h={6} m={MAT.dark} position={[-2.0, 4, 0]} rotation={[0, 0, 0.35]} />
        <group ref={auger} position={[0.7, 1.2, 0]}>
          <Cyl r={0.42} h={10} m={MAT.steel} position={[0, 5, 0]} seg={10} />
          <Box s={[1.0, 1.0, 1.0]} r={0.15} m={MAT.dark} position={[0, 10.5, 0]} />
        </group>
      </group>
      <Beacon position={[-0.4, 2.6, 1.2]} />
    </group>
  )
}

export function Drone({ id }: { id: string }) {
  const root = useRef<THREE.Group>(null!)
  const rotors = useRef<THREE.Group>(null!)
  useMachineDrive(id, root, 1, 1, () => {}, true)
  useFrame((_, dt) => {
    rotors.current?.children.forEach((r, i) => (r.rotation.y += dt * (i % 2 ? 60 : -60)))
  })
  return (
    <group ref={root} scale={2.2}>
      <Box s={[0.5, 0.18, 0.32]} r={0.07} m={MAT.white} />
      <Box s={[0.3, 0.02, 0.33]} m={MAT.accent} position={[0, 0.09, 0]} shadow={false} />
      <Box s={[1.15, 0.05, 0.06]} m={MAT.dark} rotation={[0, Math.PI / 4, 0]} />
      <Box s={[1.15, 0.05, 0.06]} m={MAT.dark} rotation={[0, -Math.PI / 4, 0]} />
      <Box s={[0.12, 0.12, 0.12]} r={0.04} m={MAT.darkMatte} position={[0.22, -0.14, 0]} />
      <group ref={rotors}>
        {[[0.4, 0.4], [0.4, -0.4], [-0.4, 0.4], [-0.4, -0.4]].map(([x, z]) => (
          <mesh key={`${x}${z}`} position={[x, 0.06, z]}>
            <cylinderGeometry args={[0.24, 0.24, 0.01, 18]} />
            <meshBasicMaterial color="#dfe8f2" transparent opacity={0.28} depthWrite={false} />
          </mesh>
        ))}
      </group>
      <Decal text={id} w={0.3} h={0.15} rotation={[-Math.PI / 2, 0, -Math.PI / 2]} position={[-0.1, 0.1, 0]} />
    </group>
  )
}

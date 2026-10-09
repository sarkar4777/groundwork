import * as THREE from 'three'
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { craneAt, hot, interpAlpha, machineAt } from '../../live/hot'
import type { Crane, Machine } from '../../proto/types'
import { MAT, hazardMat } from '../materials'
import { heightAt } from '../ground/heights'
import { Beacon, Box, Cyl, Decal, Lattice, Wheel, spanPoints } from './parts'

export const TOWER = { mast: 46, jib: 55, counter: 14 }
export const MOBILE = { pivotH: 3.4, min: 14, max: 48 }

export const craneRig = new Map<string, { base: THREE.Vector3; tip: THREE.Vector3; hook: THREE.Vector3; slew: number; radius: number; cab: THREE.Object3D | null }>()

export function craneBase(id: string, scratch: Machine): { x: number; y: number } | null {
  const m = machineAt(id, scratch, 1)
  if (m) return m
  const b = hot.site?.craneBases.find((c) => c.id === id)
  return b ?? null
}

function useCrane(id: string, kind: 'tower' | 'mobile', fn: (c: Crane, base: { x: number; y: number }, r: number, slew: number, luff: number) => void) {
  const cs = useMemo(() => ({ hook: [0, 0, 0] }) as unknown as Crane, [])
  const ms = useMemo(() => ({ joints: {} }) as Machine, [])
  useFrame(() => {
    const c = craneAt(id, cs, interpAlpha())
    const base = craneBase(id, ms)
    if (!c || !base) return
    const dx = c.hook[0] - base.x, dy = c.hook[1] - base.y
    const r = Math.hypot(dx, dy)
    const slew = r > 1 ? Math.atan2(dy, dx) : c.slew
    const L = kind === 'tower' ? TOWER.jib : THREE.MathUtils.clamp(r / Math.max(0.2, Math.cos(c.luff)), MOBILE.min, MOBILE.max)
    const luff = kind === 'tower' ? Math.acos(THREE.MathUtils.clamp(r / L, 0.05, 0.999)) : c.luff
    fn(c, base, kind === 'tower' ? r : L, slew, luff)
  })
}

const tmp = new THREE.Vector3()
const hookV = new THREE.Vector3()

export function TowerCrane({ id }: { id: string }) {
  const root = useRef<THREE.Group>(null!)
  const slewG = useRef<THREE.Group>(null!)
  const jib = useRef<THREE.Group>(null!)
  const tip = useRef<THREE.Object3D>(null!)
  const cab = useRef<THREE.Object3D>(null!)
  const rope = useRef<THREE.Mesh>(null!)
  const hook = useRef<THREE.Group>(null!)
  const cage = useRef<THREE.Group>(null!)

  useCrane(id, 'tower', (c, base, r, slew, luff) => {
    root.current.visible = true
    root.current.position.set(base.x, heightAt(base.x, base.y), -base.y)
    slewG.current.rotation.y = slew
    jib.current.rotation.z = luff
    hookV.set(c.hook[0], heightAt(c.hook[0], c.hook[1]) + Math.max(1.5, c.hook[2]), -c.hook[1])
    hook.current.position.copy(hookV)
    hook.current.rotation.y = slew
    tip.current.getWorldPosition(tmp)
    spanPoints(rope.current, tmp, hookV)
    cage.current.visible = c.load_t > 0.05
    craneRig.set(id, { base: root.current.position.clone(), tip: tmp.clone(), hook: hookV.clone(), slew, radius: r, cab: cab.current })
  })

  const H = TOWER.mast
  return (
    <>
      <group ref={root} visible={false}>
        <Box s={[6, 1.2, 6]} r={0.1} m={MAT.concrete} position={[0, 0.6, 0]} />
        <Lattice len={H} size={2} position={[0, H / 2 + 1.2, 0]} />
        <group ref={slewG} position={[0, H + 1.2, 0]}>
          <Box s={[3.2, 1.4, 3.2]} r={0.15} position={[0, 0.7, 0]} />
          <Box s={[3.22, 0.08, 3.22]} m={MAT.accent} position={[0, 1.1, 0]} shadow={false} />
          <group position={[1.6, 1.6, -1.6]}>
            <Box s={[2.0, 2.2, 1.6]} r={0.18} position={[0, 0.2, 0]} />
            <Box s={[2.02, 1.4, 1.62]} r={0.14} m={MAT.glass} position={[0.1, 0.4, 0]} shadow={false} />
            <object3D ref={cab} position={[0.6, 0.4, 0]} />
          </group>
          <Lattice len={TOWER.counter} size={1.4} rotation={[0, 0, Math.PI / 2]} position={[-TOWER.counter / 2, 1.8, 0]} />
          <Box s={[3.2, 2.6, 2.6]} r={0.1} m={MAT.concrete} position={[-TOWER.counter + 2, 0.6, 0]} />
          <Box s={[3.22, 0.3, 2.62]} m={hazardMat()} position={[-TOWER.counter + 2, 2.0, 0]} shadow={false} />
          <Lattice len={9} size={1.2} position={[-1.0, 6, 0]} rotation={[0, 0, 0.12]} />
          <Beacon position={[-1.4, 10.6, 0]} />
          <Decal text={id} w={2.4} h={1.2} rotation={[-Math.PI / 2, 0, -Math.PI / 2]} position={[-TOWER.counter + 2, 2.16, 0]} />
          <group ref={jib} position={[1.6, 2.0, 0]}>
            <Lattice len={TOWER.jib} size={1.3} rotation={[0, 0, -Math.PI / 2]} position={[TOWER.jib / 2, 0, 0]} />
            <Box s={[1.0, 1.0, 1.6]} r={0.1} m={MAT.dark} position={[TOWER.jib, 0, 0]} />
            <object3D ref={tip} position={[TOWER.jib, -0.6, 0]} />
          </group>
        </group>
      </group>
      <mesh ref={rope} material={MAT.darkMatte}>
        <cylinderGeometry args={[0.06, 0.06, 1, 6]} />
      </mesh>
      <group ref={hook}>
        <Box s={[0.9, 1.1, 0.5]} r={0.1} m={MAT.paint} position={[0, 0.3, 0]} />
        <group ref={cage} position={[0, -2.1, 0]}>
          <mesh castShadow>
            <boxGeometry args={[7, 2.2, 2.2]} />
            <meshStandardMaterial color="#7a5638" roughness={0.6} metalness={0.6} wireframe />
          </mesh>
          <Box s={[7, 0.12, 2.2]} m={MAT.rebar} position={[0, -1.1, 0]} />
        </group>
      </group>
    </>
  )
}

export function MobileCrane({ id }: { id: string }) {
  const root = useRef<THREE.Group>(null!)
  const upper = useRef<THREE.Group>(null!)
  const boom = useRef<THREE.Group>(null!)
  const s2 = useRef<THREE.Group>(null!)
  const s3 = useRef<THREE.Group>(null!)
  const tip = useRef<THREE.Object3D>(null!)
  const cab = useRef<THREE.Object3D>(null!)
  const rope = useRef<THREE.Mesh>(null!)
  const hook = useRef<THREE.Group>(null!)
  const load = useRef<THREE.Mesh>(null!)
  const ms = useMemo(() => ({ joints: {} }) as Machine, [])

  useCrane(id, 'mobile', (c, base, L, slew, luff) => {
    const m = machineAt(id, ms, 1)
    root.current.visible = true
    root.current.position.set(base.x, heightAt(base.x, base.y), -base.y)
    const heading = m?.heading ?? 0
    root.current.rotation.y = heading
    upper.current.rotation.y = slew - heading
    boom.current.rotation.z = luff
    const ext = (L - MOBILE.min) / 2
    s2.current.position.x = ext
    s3.current.position.x = ext
    hookV.set(c.hook[0], heightAt(c.hook[0], c.hook[1]) + Math.max(1.5, c.hook[2]), -c.hook[1])
    hook.current.position.copy(hookV)
    tip.current.getWorldPosition(tmp)
    spanPoints(rope.current, tmp, hookV)
    load.current.visible = c.load_t > 0.05
    craneRig.set(id, { base: root.current.position.clone(), tip: tmp.clone(), hook: hookV.clone(), slew, radius: Math.cos(luff) * L, cab: cab.current })
  })

  return (
    <>
      <group ref={root} visible={false}>
        <Box s={[12, 1.3, 2.8]} r={0.2} position={[0, 1.6, 0]} />
        <Box s={[12.02, 0.08, 2.82]} m={MAT.accent} position={[0, 1.2, 0]} shadow={false} />
        <Decal text={id} w={1.8} h={0.9} rotation={[-Math.PI / 2, 0, -Math.PI / 2]} position={[-4.5, 2.26, 0]} />
        <Box s={[2.0, 1.8, 2.6]} r={0.2} position={[5.2, 2.6, 0]} />
        <Box s={[2.02, 1.0, 2.62]} r={0.15} m={MAT.glass} position={[5.4, 2.9, 0]} shadow={false} />
        {[-4.5, -2.8, 2.2, 3.9].map((x) => [1.25, -1.25].map((z) => <Wheel key={`${x}${z}`} r={0.68} w={0.5} position={[x, 0.68, z]} />))}
        {[-5, 4].map((x) => [1, -1].map((z) => (
          <group key={`${x}${z}`} position={[x, 0.9, z * 1.4]}>
            <Box s={[0.5, 0.4, 3.2]} m={MAT.dark} position={[0, 0, z * 1.4]} />
            <Box s={[1.2, 0.2, 1.2]} m={MAT.timber} position={[0, -0.85, z * 3.0]} />
            <Cyl r={0.12} h={0.8} m={MAT.steel} position={[0, -0.4, z * 3.0]} />
          </group>
        )))}
        <group ref={upper} position={[-1.2, 2.3, 0]}>
          <Box s={[5.2, 1.4, 2.6]} r={0.2} position={[-0.8, 0.7, 0]} />
          <Box s={[1.6, 1.3, 2.4]} r={0.2} m={MAT.dark} position={[-3.6, 0.7, 0]} />
          <group position={[0.8, 0.9, -1.0]}>
            <Box s={[1.8, 1.4, 0.9]} r={0.12} />
            <Box s={[1.82, 0.8, 0.92]} r={0.1} m={MAT.glass} position={[0.1, 0.2, 0]} shadow={false} />
            <object3D ref={cab} position={[0.5, 0.3, 0]} />
          </group>
          <Beacon position={[-2.0, 1.5, 0.8]} />
          <group ref={boom} position={[0.6, 1.4, 0.3]}>
            <Box s={[MOBILE.min, 1.0, 0.95]} r={0.15} position={[MOBILE.min / 2 - 1, 0, 0]} />
            <Box s={[MOBILE.min, 0.06, 0.97]} m={MAT.accent} position={[MOBILE.min / 2 - 1, 0.35, 0]} shadow={false} />
            <group ref={s2}>
              <Box s={[MOBILE.min, 0.8, 0.75]} r={0.12} m={MAT.paintDirty} position={[MOBILE.min / 2 - 1, 0, 0]} />
              <group ref={s3}>
                <Box s={[MOBILE.min, 0.6, 0.58]} r={0.1} position={[MOBILE.min / 2 - 1, 0, 0]} />
                <Box s={[0.9, 0.9, 0.8]} r={0.1} m={MAT.dark} position={[MOBILE.min - 1, 0, 0]} />
                <object3D ref={tip} position={[MOBILE.min - 1, -0.5, 0]} />
              </group>
            </group>
          </group>
        </group>
      </group>
      <mesh ref={rope} material={MAT.darkMatte}>
        <cylinderGeometry args={[0.05, 0.05, 1, 6]} />
      </mesh>
      <group ref={hook}>
        <Box s={[0.6, 0.8, 0.4]} r={0.08} m={MAT.paint} position={[0, 0.3, 0]} />
        <mesh ref={load} position={[0, -1.0, 0]} castShadow material={MAT.timber}>
          <boxGeometry args={[4.8, 0.25, 2.4]} />
        </mesh>
      </group>
    </>
  )
}

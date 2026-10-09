import * as THREE from 'three'
import { forwardRef, useMemo } from 'react'
import type { ThreeElements } from '@react-three/fiber'
import { MAT, cyl, latticeMat, numberDecal, rbox } from '../materials'

type MeshProps = Omit<ThreeElements['mesh'], 'args'>

export const Box = forwardRef<THREE.Mesh, MeshProps & { s: [number, number, number]; r?: number; m?: THREE.Material; shadow?: boolean }>(
  function Box({ s, r = 0.08, m = MAT.paint, shadow = true, ...rest }, ref) {
    return <mesh ref={ref} geometry={rbox(s[0], s[1], s[2], r)} material={m} castShadow={shadow} receiveShadow={shadow} {...rest} />
  },
)

export const Cyl = forwardRef<THREE.Mesh, MeshProps & { r: number; r2?: number; h: number; m?: THREE.Material; seg?: number; shadow?: boolean }>(
  function Cyl({ r, r2, h, m = MAT.steel, seg = 14, shadow = true, ...rest }, ref) {
    return <mesh ref={ref} geometry={cyl(r, r2 ?? r, h, seg)} material={m} castShadow={shadow} {...rest} />
  },
)

export function Wheel({ r = 0.8, w = 0.6, ...rest }: { r?: number; w?: number } & MeshProps) {
  return (
    <group {...(rest as ThreeElements['group'])}>
      <mesh geometry={cyl(r, r, w, 20)} material={MAT.rubber} rotation={[Math.PI / 2, 0, 0]} castShadow />
      <mesh geometry={cyl(r * 0.55, r * 0.55, w + 0.02, 12)} material={MAT.paint} rotation={[Math.PI / 2, 0, 0]} />
    </group>
  )
}

export function Track({ len = 4.8, w = 0.62, h = 0.95, ...rest }: { len?: number; w?: number; h?: number } & ThreeElements['group']) {
  return (
    <group {...rest}>
      <Box s={[len, h, w]} r={h * 0.45} m={MAT.rubber} />
      <Box s={[len * 0.7, h * 0.5, w + 0.04]} r={0.08} m={MAT.dark} position={[0, 0.02, 0]} shadow={false} />
    </group>
  )
}

export function Decal({ text, w, h, ...rest }: { text: string; w: number; h: number } & MeshProps) {
  const geo = useMemo(() => new THREE.PlaneGeometry(w, h), [w, h])
  return <mesh geometry={geo} material={numberDecal(text)} {...rest} />
}

export function Beacon(props: ThreeElements['group']) {
  return (
    <group {...props}>
      <Cyl r={0.09} h={0.16} m={MAT.beacon} shadow={false} />
    </group>
  )
}

const latticeGeoCache = new Map<string, THREE.BufferGeometry>()

// Square lattice section: a box with UVs scaled so the truss pattern keeps its proportion.
export function latticeGeo(len: number, size: number): THREE.BufferGeometry {
  const key = `${len}|${size}`
  let g = latticeGeoCache.get(key)
  if (!g) {
    g = new THREE.BoxGeometry(size, len, size)
    const uv = g.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * (len / (size * 2)))
    latticeGeoCache.set(key, g)
  }
  return g
}

export function Lattice({ len, size, ...rest }: { len: number; size: number } & MeshProps) {
  return <mesh geometry={latticeGeo(len, size)} material={latticeMat()} castShadow {...rest} />
}

const tmpA = new THREE.Vector3()
const tmpB = new THREE.Vector3()
const up = new THREE.Vector3(0, 1, 0)

// Stretch a unit-height cylinder between two world points, expressed in parent space.
export function spanBetween(mesh: THREE.Object3D, a: THREE.Object3D, b: THREE.Object3D) {
  const parent = mesh.parent
  if (!parent) return
  a.getWorldPosition(tmpA)
  b.getWorldPosition(tmpB)
  parent.worldToLocal(tmpA)
  parent.worldToLocal(tmpB)
  mesh.position.copy(tmpA).add(tmpB).multiplyScalar(0.5)
  const len = tmpA.distanceTo(tmpB)
  mesh.scale.set(1, Math.max(0.001, len), 1)
  tmpB.sub(tmpA).normalize()
  mesh.quaternion.setFromUnitVectors(up, tmpB)
}

export function spanPoints(mesh: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) {
  mesh.position.copy(a).add(b).multiplyScalar(0.5)
  mesh.scale.set(1, Math.max(0.001, a.distanceTo(b)), 1)
  tmpB.copy(b).sub(a).normalize()
  mesh.quaternion.setFromUnitVectors(up, tmpB)
}

import * as THREE from 'three'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { dimWithNervous } from '../materials'
import { riverX } from './paint'

// A neighbourhood of perimeter blocks: terraces along the streets, courtyards behind, a park,
// a car park and a warehouse or two. Streets every 90 m, the yard sits in the middle cell.
export const PITCH = 90
export const ROAD = 11
export const PAVE = 4.5

export interface Bldg { x: number; y: number; w: number; d: number; h: number; rot: number; kind: number }
export interface Spot { x: number; y: number; rot: number; s: number; c?: string }

let rs = 23
const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647)

const inYard = (x: number, y: number, m = 0) => Math.abs(x) < 104 + m && Math.abs(y) < 104 + m
const inRiver = (x: number, y: number) => Math.abs(x - riverX(y)) < 44
const inRail = (x: number) => x > 182 && x < 218

export function cityLayout() {
  rs = 23
  const bldgs: Bldg[] = []
  const trees: Spot[] = []
  const cars: Spot[] = []
  const roof: Bldg[] = []
  const carCols = ['#d9dde1', '#23272e', '#8b1e28', '#3b5470', '#b7b9bb', '#16181c', '#5d6a72', '#e7e3da', '#2f4a3a']
  for (let bx = -6; bx <= 6; bx++) {
    for (let by = -6; by <= 6; by++) {
      const cx = bx * PITCH, cy = by * PITCH
      if (inYard(cx, cy, 20)) continue
      if (inRiver(cx, cy) || cx < riverX(cy) - 40) {
        for (let i = 0; i < 26; i++) trees.push({ x: cx + (rnd() - 0.5) * 80, y: cy + (rnd() - 0.5) * 80, rot: rnd() * 6, s: 3.5 + rnd() * 4 })
        continue
      }
      if (inRail(cx)) continue
      const half = PITCH / 2 - ROAD / 2 - PAVE - 1
      const kind = rnd()
      if (kind < 0.1) {
        // park
        for (let i = 0; i < 22; i++) trees.push({ x: cx + (rnd() - 0.5) * half * 1.8, y: cy + (rnd() - 0.5) * half * 1.8, rot: rnd() * 6, s: 3 + rnd() * 4 })
        continue
      }
      if (kind < 0.2) {
        // shed and yard
        bldgs.push({ x: cx + (rnd() - 0.5) * 10, y: cy + (rnd() - 0.5) * 10, w: 42 + rnd() * 14, d: 30 + rnd() * 12, h: 8 + rnd() * 3, rot: 0, kind: 3 })
        for (let i = 0; i < 18; i++) cars.push({ x: cx - half + 6 + (i % 9) * 2.6, y: cy - half + 4 + Math.floor(i / 9) * 6, rot: Math.PI / 2, s: 1, c: carCols[Math.floor(rnd() * carCols.length)] })
        continue
      }
      // terraces along each street edge, depth 11 to 15 m
      const k = Math.floor(rnd() * 3)
      const h0 = 9 + rnd() * 9
      for (const side of [0, 1, 2, 3]) {
        let s = -half
        while (s < half - 8) {
          const len = Math.min(half - s, 12 + rnd() * 22)
          const dep = 11 + rnd() * 4
          const along = s + len / 2
          const off = half - dep / 2
          const h = h0 + (rnd() < 0.25 ? 3.2 * Math.floor(1 + rnd() * 3) : 0)
          const b: Bldg =
            side === 0 ? { x: cx + along, y: cy + off, w: len, d: dep, h, rot: 0, kind: k }
            : side === 1 ? { x: cx + along, y: cy - off, w: len, d: dep, h, rot: 0, kind: k }
            : side === 2 ? { x: cx + off, y: cy + along, w: dep, d: len, h, rot: 0, kind: k }
            : { x: cx - off, y: cy + along, w: dep, d: len, h, rot: 0, kind: k }
          if (side >= 2 && Math.abs(along) > half - dep) {
            s += len + 0.5
            continue
          }
          if (rnd() > 0.08) bldgs.push(b)
          s += len + (rnd() < 0.2 ? 4 + rnd() * 5 : 0.4)
        }
      }
      // courtyard trees
      for (let i = 0; i < 4; i++) trees.push({ x: cx + (rnd() - 0.5) * 30, y: cy + (rnd() - 0.5) * 30, rot: rnd() * 6, s: 2.5 + rnd() * 3 })
    }
  }
  // rooftop plant on the flat roofs
  for (const b of bldgs) {
    const n = b.kind === 3 ? 4 : Math.floor(rnd() * 3)
    for (let i = 0; i < n; i++) {
      const w = 1.2 + rnd() * 2.6, d = 1.2 + rnd() * 2.2
      roof.push({ x: b.x + (rnd() - 0.5) * (b.w - w - 2), y: b.y + (rnd() - 0.5) * (b.d - d - 2), w, d, h: b.h + 0.6 + rnd() * 1.2, rot: 0, kind: 0 })
    }
  }
  // street trees and parked cars along the kerbs
  for (let k = -7; k <= 7; k++) {
    const v = k * PITCH + PITCH / 2
    for (let t = -600; t < 600; t += 3) {
      for (const side of [-1, 1]) {
        const off = side * (ROAD / 2 + 1.1)
        const vx = v + off, hy = v + off
        if (rnd() < 0.025) trees.push({ x: v + side * (ROAD / 2 + PAVE - 1), y: t, rot: rnd() * 6, s: 2.6 + rnd() * 1.8 })
        if (rnd() < 0.025) trees.push({ x: t, y: v + side * (ROAD / 2 + PAVE - 1), rot: rnd() * 6, s: 2.6 + rnd() * 1.8 })
        if (rnd() < 0.1 && Math.abs(t) < 420 && !inYard(vx, t, 6) && !inRiver(vx, t) && !inRail(vx) && vx > riverX(t)) cars.push({ x: vx, y: t, rot: Math.PI / 2, s: 1, c: carCols[Math.floor(rnd() * carCols.length)] })
        if (rnd() < 0.1 && Math.abs(t) < 420 && !inYard(t, hy, 6) && !inRiver(t, hy) && !inRail(t) && t > riverX(hy)) cars.push({ x: t, y: hy, rot: 0, s: 1, c: carCols[Math.floor(rnd() * carCols.length)] })
      }
    }
  }
  const okTree = (p: Spot) => !inYard(p.x, p.y, 4) && !inRail(p.x) && Math.abs(p.x - riverX(p.y)) > 30
  return { bldgs, trees: trees.filter(okTree), cars, roof }
}

// Facade textures in world space, floors and window bays on top, a gravel membrane on the roof.
function facadeMaterial(wall: THREE.Texture, roofTex: THREE.Texture, tint: string, bay: number) {
  const m = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.85, metalness: 0.02 })
  m.customProgramCacheKey = () => 'gw-facade'
  m.onBeforeCompile = (sh) => {
    sh.uniforms.tWall = { value: wall }
    sh.uniforms.uBay = { value: bay }
    sh.uniforms.tRoof = { value: roofTex }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBW;\nvarying vec3 vBN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvBW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\nvBN = normalize(mat3(modelMatrix * instanceMatrix) * objectNormal);')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vBW;
varying vec3 vBN;
uniform sampler2D tWall;
uniform sampler2D tRoof;
uniform float uBay;
float bh(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float gwWet = 0.0;`)
      .replace(
        '#include <map_fragment>',
        `if (vBN.y > 0.5) {
  diffuseColor.rgb = texture2D(tRoof, vBW.xz / 6.0).rgb * vec3(0.95, 0.95, 0.98) * (0.8 + 0.25 * bh(floor(vBW.xz / 37.0)));
} else {
  float along = abs(vBN.x) > 0.5 ? vBW.z : vBW.x;
  diffuseColor.rgb *= texture2D(tWall, vec2(along, vBW.y) / 3.2).rgb * 1.6;
  float fl = fract(vBW.y / 3.2);
  float bayf = fract(along / uBay);
  float win = step(0.36, fl) * step(fl, 0.84) * step(0.2, bayf) * step(bayf, 0.8) * step(1.4, vBW.y);
  float frame = win * (1.0 - step(0.39, fl) * step(fl, 0.81) * step(0.24, bayf) * step(bayf, 0.76));
  float lit = step(0.95, bh(vec2(floor(along / uBay), floor(vBW.y / 3.2))));
  vec3 glass = mix(vec3(0.05, 0.065, 0.08), vec3(0.85, 0.66, 0.42), lit * 0.55);
  diffuseColor.rgb = mix(diffuseColor.rgb, glass, win);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.63, 0.64), frame * 0.8);
  gwWet = win - frame;
  diffuseColor.rgb *= 0.78 + 0.22 * smoothstep(0.0, 4.0, vBW.y);
}`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.12, gwWet);')
  }
  return m
}

function loadTex(url: string, srgb = true) {
  const t = new THREE.TextureLoader().load(url)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  t.anisotropy = 4
  return t
}

const T = '/assets/textures/'
let mats: THREE.MeshStandardMaterial[] | null = null
function materials() {
  if (mats) return mats
  const roofTex = loadTex(T + 'tarred_gravel_diff_1k.jpg')
  mats = [
    facadeMaterial(loadTex(T + 'brick_wall_10_diff_1k.jpg'), roofTex, '#d8d0c8', 2.8),
    facadeMaterial(loadTex(T + 'dark_brick_wall_diff_1k.jpg'), roofTex, '#cfc8c0', 3.2),
    facadeMaterial(loadTex(T + 'grey_plaster_02_diff_1k.jpg'), roofTex, '#c2c0bc', 3.6),
    facadeMaterial(loadTex(T + 'rectangular_facade_tiles_diff_1k.jpg'), roofTex, '#a9adb2', 6.0),
  ]
  dimWithNervous(...mats)
  return mats
}

const treeMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 })

// A lumpy canopy: a few overlapping blobs merged, so a tree reads as foliage from above.
function canopyGeometry() {
  const parts: THREE.BufferGeometry[] = []
  const blobs: [number, number, number, number][] = [[0, 0, 0, 1], [0.45, -0.15, 0.2, 0.7], [-0.4, -0.1, -0.25, 0.72], [0.1, 0.25, -0.45, 0.6], [-0.15, 0.2, 0.45, 0.62]]
  for (const [x, y, z, r] of blobs) {
    const g = new THREE.IcosahedronGeometry(r, 1)
    const p = g.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < p.count; i++) {
      const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i)
      const n = 1 + 0.12 * Math.sin(vx * 7.1 + vz * 3.3) * Math.cos(vy * 5.7 + vx * 2.1)
      p.setXYZ(i, vx * n + x, vy * n * 0.85 + y, vz * n + z)
    }
    parts.push(g)
  }
  const m = mergeGeometries(parts)!
  m.computeVertexNormals()
  return m
}
const roofMat = new THREE.MeshStandardMaterial({ color: '#9ba0a4', roughness: 0.6, metalness: 0.4 })
const carMat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.25, envMapIntensity: 0.6 })
const waterMat = new THREE.MeshStandardMaterial({ color: '#16282c', roughness: 0.06, metalness: 0.3, envMapIntensity: 1.1 })
const hoardMat = new THREE.MeshStandardMaterial({ color: '#1d3557', roughness: 0.65 })
dimWithNervous(treeMat, roofMat, carMat, waterMat, hoardMat)

function useInstances(ref: React.RefObject<THREE.InstancedMesh>, items: (Bldg | Spot)[], fn: (it: Bldg & Spot, m: THREE.Matrix4) => void, color?: (it: Bldg & Spot) => string | undefined) {
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const m = new THREE.Matrix4()
    const c = new THREE.Color()
    items.forEach((it, i) => {
      fn(it as Bldg & Spot, m)
      mesh.setMatrixAt(i, m)
      const col = color?.(it as Bldg & Spot)
      if (col) mesh.setColorAt(i, c.set(col))
    })
    mesh.count = items.length
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  })
}

const q = new THREE.Quaternion()
const yAxis = new THREE.Vector3(0, 1, 0)

export function City() {
  const L = useMemo(() => cityLayout(), [])
  const ms = materials()
  const byKind = useMemo(() => [0, 1, 2, 3].map((k) => L.bldgs.filter((b) => b.kind === k)), [L])
  const refs = [useRef<THREE.InstancedMesh>(null!), useRef<THREE.InstancedMesh>(null!), useRef<THREE.InstancedMesh>(null!), useRef<THREE.InstancedMesh>(null!)]
  const trees = useRef<THREE.InstancedMesh>(null!)
  const roof = useRef<THREE.InstancedMesh>(null!)
  const cars = useRef<THREE.InstancedMesh>(null!)
  const box = (it: Bldg, m: THREE.Matrix4) => m.compose(new THREE.Vector3(it.x, it.h / 2, -it.y), q.setFromAxisAngle(yAxis, it.rot), new THREE.Vector3(it.w, it.h, it.d))
  for (let k = 0; k < 4; k++) useInstances(refs[k], byKind[k], box)
  useInstances(roof, L.roof, box)
  useInstances(trees, L.trees, (it, m) => m.compose(new THREE.Vector3(it.x, it.s * 1.1, -it.y), q.setFromAxisAngle(yAxis, it.rot), new THREE.Vector3(it.s, it.s * 0.9, it.s)), (it) => ['#2f4226', '#3a4f2c', '#283a22', '#45563a'][Math.floor((it.rot * 7) % 4)])
  useInstances(cars, L.cars, (it, m) => m.compose(new THREE.Vector3(it.x, 0, -it.y), q.setFromAxisAngle(yAxis, it.rot), new THREE.Vector3(1, 1, 1)), (it) => it.c)
  const canopy = useMemo(() => canopyGeometry(), [])
  const carGeo = useMemo(() => {
    const body = new THREE.BoxGeometry(4.4, 0.75, 1.8)
    body.translate(0, 0.55, 0)
    const cab = new THREE.BoxGeometry(2.4, 0.6, 1.62)
    cab.translate(-0.2, 1.15, 0)
    return mergeGeometries([body, cab])!
  }, [])
  const riverGeo = useMemo(() => {
    const pts: THREE.Vector2[] = []
    for (let y = -600; y <= 600; y += 10) pts.push(new THREE.Vector2(riverX(y) - 26, y))
    for (let y = 600; y >= -600; y -= 10) pts.push(new THREE.Vector2(riverX(y) + 26, y))
    const g = new THREE.ShapeGeometry(new THREE.Shape(pts))
    g.rotateX(-Math.PI / 2)
    return g
  }, [])
  return (
    <group>
      {[0, 1, 2, 3].map((k) => (
        <instancedMesh key={k} ref={refs[k]} args={[undefined, ms[k], Math.max(1, byKind[k].length)]} receiveShadow>
          <boxGeometry args={[1, 1, 1]} />
        </instancedMesh>
      ))}
      <instancedMesh ref={roof} args={[undefined, roofMat, Math.max(1, L.roof.length)]}>
        <boxGeometry args={[1, 1, 1]} />
      </instancedMesh>
      <instancedMesh ref={trees} args={[canopy, treeMat, Math.max(1, L.trees.length)]} />
      <instancedMesh ref={cars} args={[carGeo, carMat, Math.max(1, L.cars.length)]} />
      <mesh geometry={riverGeo} material={waterMat} position={[0, 0.05, 0]} />
      <Hoarding />
    </group>
  )
}

// Solid hoarding panels on posts round the yard, with a gap at the gate.
function Hoarding() {
  const H = 2.4
  const segs: [number, number, number, number][] = [
    [-100, 100, 100, 100],
    [100, 100, 100, -100],
    [-100, -100, -9, -100],
    [9, -100, 100, -100],
    [-100, -100, -100, 100],
  ]
  const posts = useMemo(() => {
    const out: [number, number][] = []
    for (const [x0, y0, x1, y1] of segs) {
      const n = Math.floor(Math.hypot(x1 - x0, y1 - y0) / 3.5)
      for (let i = 0; i <= n; i++) out.push([x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n])
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const ref = useRef<THREE.InstancedMesh>(null!)
  useLayoutEffect(() => {
    const m = new THREE.Matrix4()
    posts.forEach(([x, y], i) => ref.current.setMatrixAt(i, m.makeTranslation(x, H / 2 + 0.1, -y)))
    ref.current.instanceMatrix.needsUpdate = true
  }, [posts])
  return (
    <group>
      {segs.map(([x0, y0, x1, y1], i) => {
        const len = Math.hypot(x1 - x0, y1 - y0)
        return (
          <mesh key={i} material={hoardMat} position={[(x0 + x1) / 2, H / 2, -(y0 + y1) / 2]} rotation={[0, Math.atan2(y1 - y0, x1 - x0), 0]} castShadow receiveShadow>
            <boxGeometry args={[len, H, 0.1]} />
          </mesh>
        )
      })}
      <instancedMesh ref={ref} args={[undefined, roofMat, posts.length]} castShadow>
        <boxGeometry args={[0.12, H + 0.2, 0.12]} />
      </instancedMesh>
    </group>
  )
}

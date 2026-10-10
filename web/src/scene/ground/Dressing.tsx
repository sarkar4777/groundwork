import * as THREE from 'three'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { hot } from '../../live/hot'
import { useUi } from '../../live/store'
import type { Vec2 } from '../../proto/types'
import { dimWithNervous, rbox } from '../materials'
import { heightAt } from './heights'

interface Item { x: number; y: number; z?: number; w: number; h: number; d: number; rot: number; color?: string }

let s = 41
const r = () => ((s = (s * 16807) % 2147483647) / 2147483647)

const bbox = (p: Vec2[]) => {
  const xs = p.map((q) => q[0]), ys = p.map((q) => q[1])
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
}

const T = '/assets/textures/'
function tex(name: string, rx = 1, ry = 1) {
  const t = new THREE.TextureLoader().load(T + name)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(rx, ry)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

// Portakabin side: white panels, a band of windows and a door.
function cabinTexture() {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 160
  const g = c.getContext('2d')!
  g.fillStyle = '#b4b9bd'
  g.fillRect(0, 0, 512, 160)
  g.fillStyle = 'rgba(0,0,0,0.08)'
  for (let x = 0; x < 512; x += 8) g.fillRect(x, 0, 2, 160)
  g.fillStyle = '#2b4d7d'
  g.fillRect(0, 148, 512, 12)
  g.fillRect(0, 0, 512, 8)
  for (const x of [30, 140, 330, 430]) {
    g.fillStyle = '#5d6670'
    g.fillRect(x - 2, 40, 64, 52)
    g.fillStyle = '#18232e'
    g.fillRect(x, 42, 60, 48)
    g.fillStyle = 'rgba(160, 190, 220, 0.25)'
    g.fillRect(x + 4, 44, 22, 44)
  }
  g.fillStyle = '#3f4a56'
  g.fillRect(238, 30, 46, 118)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

// Heras fence panel: mesh in a tube frame, alpha tested.
function fenceTexture() {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 128
  const g = c.getContext('2d')!
  g.strokeStyle = '#c9ccce'
  g.lineWidth = 1.5
  for (let x = 6; x < 250; x += 9) {
    g.beginPath()
    g.moveTo(x, 6)
    g.lineTo(x, 122)
    g.stroke()
  }
  for (let y = 6; y < 122; y += 18) {
    g.beginPath()
    g.moveTo(6, y)
    g.lineTo(250, y)
    g.stroke()
  }
  g.lineWidth = 6
  g.strokeRect(4, 4, 248, 120)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

// Irregular stockpile: a squashed, noisy cone that keeps a flat base.
function heapGeometry() {
  // a tipped pile: angle-of-repose flanks, a rounded crest, lobed footprint and lumps where loads were dropped
  const g = new THREE.SphereGeometry(1, 72, 22, 0, Math.PI * 2, 0, Math.PI / 2)
  const p = g.attributes.position as THREE.BufferAttribute
  const hgt = new Float32Array(p.count)
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
    const a = Math.atan2(z, x)
    const k = 1 + 0.1 * Math.sin(a * 3 + 1) + 0.06 * Math.sin(a * 7) + 0.03 * Math.sin(a * 13 + 2)
    const t = Math.min(1, y)
    const lump = Math.sin(x * 5.1 + z * 2.3) * Math.cos(z * 4.7 - x * 1.9) * 0.035 * Math.sin(t * Math.PI)
    const h = Math.pow(t, 1.3) + lump
    const r = 1 + lump * 0.6
    p.setXYZ(i, x * k * r, h - 0.5, z * k * r)
    hgt[i] = h
  }
  g.setAttribute('aH', new THREE.BufferAttribute(hgt, 1))
  g.computeVertexNormals()
  return g
}

// Soft dark ground under each pile where fines and moisture collect.
function apronTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(64, 64, 20, 64, 64, 64)
  grd.addColorStop(0, 'rgba(0,0,0,0.75)')
  grd.addColorStop(0.55, 'rgba(0,0,0,0.4)')
  grd.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}

const mats = {
  cabin: new THREE.MeshStandardMaterial({ map: cabinTexture(), roughness: 0.6 }),
  cabinRoof: new THREE.MeshStandardMaterial({ color: '#7d8388', roughness: 0.6, metalness: 0.4 }),
  container: new THREE.MeshStandardMaterial({ map: tex('corrugated_iron_diff_1k.jpg', 3, 1), roughness: 0.6, metalness: 0.35 }),
  wood: new THREE.MeshStandardMaterial({ map: tex('wood_planks_diff_1k.jpg', 1, 1), roughness: 0.85 }),
  ply: new THREE.MeshStandardMaterial({ map: tex('plywood_diff_1k.jpg', 1, 1), roughness: 0.8 }),
  rebar: new THREE.MeshStandardMaterial({ color: '#5b3a28', roughness: 0.6, metalness: 0.7 }),
  bags: new THREE.MeshStandardMaterial({ color: '#b9b6ae', roughness: 0.95 }),
  sand: new THREE.MeshStandardMaterial({ map: tex('sandy_gravel_diff_1k.jpg', 4, 2), roughness: 1, color: '#e2d3b4' }),
  stone: new THREE.MeshStandardMaterial({ map: tex('aerial_ground_rock_diff_2k.jpg', 5, 2), roughness: 1, color: '#eeeae2' }),
  topsoil: new THREE.MeshStandardMaterial({ map: tex('dirt_aerial_02_diff_2k.jpg', 2, 1), roughness: 1, color: '#c9b49c' }),
  cone: new THREE.MeshStandardMaterial({ color: '#ff5a14', roughness: 0.55 }),
  apron: new THREE.MeshBasicMaterial({ map: apronTexture(), color: '#1a120c', transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }),
  pile: new THREE.MeshStandardMaterial({ color: '#b9b5ac', roughness: 0.9 }),
  tube: new THREE.MeshStandardMaterial({ color: '#9ea4aa', roughness: 0.4, metalness: 0.8 }),
  board: new THREE.MeshStandardMaterial({ color: '#a07d52', roughness: 0.9 }),
  fence: new THREE.MeshStandardMaterial({ map: fenceTexture(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.4, metalness: 0.7 }),
  foot: new THREE.MeshStandardMaterial({ color: '#2a2d31', roughness: 0.8 }),
  car: new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.25, envMapIntensity: 0.6 }),
}
for (const k of ['sand', 'stone', 'topsoil'] as const) worldMapped(mats[k], k === 'topsoil' ? 14 : k === 'sand' ? 8 : 18)
dimWithNervous(...Object.values(mats).filter((m): m is THREE.MeshStandardMaterial => m instanceof THREE.MeshStandardMaterial))

// Tile the map by world position so a stockpile has no cone seams.
function worldMapped(m: THREE.MeshStandardMaterial, metres: number) {
  m.customProgramCacheKey = () => 'gw-worldmap'
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uMetres = { value: metres }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMW;\nattribute float aH;\nvarying float vH;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvMW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\nvH = aH;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMW;\nvarying float vH;\nuniform float uMetres;')
      .replace(
        '#include <map_fragment>',
        `vec3 agg = texture2D(map, vMW.xz / uMetres + vMW.y * 0.05).rgb;
agg = mix(vec3(dot(agg, vec3(0.333))), agg, 0.7) * mix(0.84, 1.06, smoothstep(0.0, 0.5, vH));
agg *= mix(0.78, 1.0, smoothstep(0.0, 0.12, vH));
diffuseColor.rgb *= agg;`,
      )
  }
}

function layout() {
  s = 41
  const site = hot.site
  const L: Record<string, Item[]> = { cabin: [], container: [], wood: [], ply: [], rebar: [], bags: [], sand: [], stone: [], topsoil: [], cone: [], pile: [], tube: [], board: [], fence: [], car: [] }
  const zone = (re: RegExp) => site?.zones.find((z) => re.test(z.kind) || re.test(z.label))
  const wz = zone(/welfare|cabin|walkway/)
  const cb = wz ? bbox(wz.polygon) : { x0: -94, x1: -66, y0: -94, y1: -72 }
  // two-high welfare cabins, a drying room container and the site office
  for (let i = 0; i < 3; i++) for (let lvl = 0; lvl < 2; lvl++) L.cabin.push({ x: cb.x0 + 6, y: cb.y0 + 2 + i * 3.1, z: lvl * 2.75, w: 9.8, h: 2.7, d: 3.0, rot: 0 })
  L.cabin.push({ x: cb.x0 + 17, y: cb.y0 + 3.5, w: 9.8, h: 2.7, d: 3.0, rot: Math.PI / 2 })
  L.container.push({ x: cb.x1 - 4, y: cb.y1 - 2.5, w: 6.06, h: 2.59, d: 2.44, rot: 0, color: '#3e6b4f' })
  L.container.push({ x: cb.x1 - 4, y: cb.y1 - 6, w: 6.06, h: 2.59, d: 2.44, rot: 0, color: '#8a3f2b' })
  L.container.push({ x: cb.x1 - 11, y: cb.y1 - 2.5, w: 12.2, h: 2.59, d: 2.44, rot: 0, color: '#2e4e7a' })
  const carCols = ['#d8dde2', '#2c3440', '#8a1f2a', '#41566e', '#cfcfcf', '#1c1f24', '#6b7175']
  for (let i = 0; i < 7; i++) L.car.push({ x: cb.x0 + 3 + i * 2.7, y: cb.y1 + 4.5, w: 1, h: 1, d: 1, rot: Math.PI / 2, color: carCols[i % carCols.length] })

  // laydown: rebar bundles on bearers, plywood and formwork, pallets of blocks and bags
  const lz = zone(/laydown/)
  if (lz) {
    const b = bbox(lz.polygon)
    for (let k = 0; k < 4; k++) {
      const bx = b.x0 + 3 + k * 3.2, by = b.y0 + (b.y1 - b.y0) * 0.62
      for (let j = 0; j < 7; j++) L.rebar.push({ x: bx + (j - 3) * 0.16, y: by, z: 0.18 + (j % 2) * 0.12, w: 0.07, h: 0.07, d: 11.5, rot: 0 })
      L.board.push({ x: bx, y: by - 4, w: 1.4, h: 0.16, d: 0.18, rot: 0 })
      L.board.push({ x: bx, y: by + 4, w: 1.4, h: 0.16, d: 0.18, rot: 0 })
    }
    for (let i = 0; i < 4; i++) L.ply.push({ x: b.x1 - 5 - (i % 2) * 4.2, y: b.y0 + 4 + Math.floor(i / 2) * 3.4, w: 2.44, h: 0.4 + r() * 0.8, d: 1.22, rot: (r() - 0.5) * 0.1 })
    for (let i = 0; i < 6; i++) {
      const x = b.x0 + 2.5 + (i % 3) * 1.6, y = b.y0 + 3 + Math.floor(i / 3) * 1.6
      L.wood.push({ x, y, w: 1.2, h: 0.14, d: 1.0, rot: 0 })
      L.bags.push({ x, y, z: 0.14, w: 1.1, h: 0.55 + r() * 0.3, d: 0.95, rot: 0 })
    }
    // Heras fence round the laydown
    const fx = [b.x0 - 1, b.x1 + 1], fy = [b.y0 - 1, b.y1 + 1]
    for (let x = fx[0]; x < fx[1] - 1; x += 3.5) for (const y of fy) L.fence.push({ x: x + 1.75, y, w: 3.4, h: 2, d: 1, rot: 0 })
    for (let y = fy[0]; y < fy[1] - 1; y += 3.5) for (const x of fx) if (!(x === fx[1] && y > fy[0] + 4 && y < fy[0] + 11)) L.fence.push({ x, y: y + 1.75, w: 3.4, h: 2, d: 1, rot: Math.PI / 2 })
  }
  // pile cage store and the piling exclusion fence
  const pz = zone(/pil/)
  const piles: Vec2[] = site?.piles?.length ? site.piles : []
  if (pz) {
    const b = bbox(pz.polygon)
    for (let y = b.y0; y < b.y1 - 1; y += 3.5) for (const x of [b.x0 - 1, b.x1 + 1]) L.fence.push({ x, y: y + 1.75, w: 3.4, h: 2, d: 1, rot: Math.PI / 2 })
    for (let x = b.x0 - 1; x < b.x1; x += 3.5) for (const y of [b.y0 - 1, b.y1 + 1]) L.fence.push({ x: x + 1.75, y, w: 3.4, h: 2, d: 1, rot: 0 })
  }
  for (const [x, y] of piles) L.pile.push({ x, y, w: 0.9, h: 0.3, d: 0.9, rot: 0 })

  // aggregate stockpiles by the gate and topsoil by the spoil area
  const gate = site?.gate ?? [0, -98]
  L.stone.push({ x: gate[0] - 30, y: gate[1] + 10, w: 11, h: 3.2, d: 9, rot: 0.4 })
  L.sand.push({ x: gate[0] - 43, y: gate[1] + 11, w: 9, h: 2.6, d: 8, rot: 1.2 })
  L.stone.push({ x: gate[0] + 36, y: gate[1] + 9, w: 8, h: 2.4, d: 7, rot: 2.1 })
  const sz = zone(/spoil/)
  if (sz) {
    const b = bbox(sz.polygon)
    L.topsoil.push({ x: b.x1 - 9, y: b.y1 - 9, w: 14, h: 4, d: 11, rot: 0.8 })
    L.topsoil.push({ x: b.x1 - 22, y: b.y1 - 6, w: 10, h: 3, d: 8, rot: 2.3 })
  }
  // scaffold access tower on the pit edge, near the core
  const core = (site as unknown as { locations?: Record<string, Vec2> })?.locations?.core
  const pit = site?.pit ? bbox(site.pit) : null
  if (pit) {
    const sx = core ? core[0] : (pit.x0 + pit.x1) / 2, sy = pit.y1 - 2
    const W = 3.0, D = 2.0, H = 12
    for (const dx of [-W / 2, W / 2]) for (const dy of [-D / 2, D / 2]) L.tube.push({ x: sx + dx, y: sy + dy, w: 0.06, h: H, d: 0.06, rot: 0 })
    for (let z = 2; z <= H; z += 2) {
      for (const dy of [-D / 2, D / 2]) L.tube.push({ x: sx, y: sy + dy, z, w: W, h: 0.05, d: 0.05, rot: 0 })
      for (const dx of [-W / 2, W / 2]) L.tube.push({ x: sx + dx, y: sy, z, w: 0.05, h: 0.05, d: D, rot: 0 })
      L.board.push({ x: sx, y: sy, z: z + 0.04, w: W, h: 0.05, d: D * 0.9, rot: 0 })
    }
  }
  // cones along the haul roads
  for (const rd of site?.haulRoads ?? []) {
    for (let i = 1; i < rd.points.length; i++) {
      const [ax, ay] = rd.points[i - 1], [bx, by] = rd.points[i]
      const len = Math.hypot(bx - ax, by - ay)
      const nx = -(by - ay) / len, ny = (bx - ax) / len
      for (let t = 4; t < len; t += 10) for (const side of [-1, 1]) {
        const k = t / len
        L.cone.push({ x: ax + (bx - ax) * k + nx * side * 6.5, y: ay + (by - ay) * k + ny * side * 6.5, w: 0.32, h: 0.62, d: 0.32, rot: 0 })
      }
    }
  }
  return L
}

const q = new THREE.Quaternion()
const yAxis = new THREE.Vector3(0, 1, 0)

function Inst({ items, geo, mat, color, base = 'bottom', shadow = true, receive = true }: { items: Item[]; geo: THREE.BufferGeometry; mat: THREE.Material; color?: boolean; base?: 'bottom' | 'centre'; shadow?: boolean; receive?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null!)
  const shown = useUi((st) => st.terrainShown)
  useLayoutEffect(() => {
    const mesh = ref.current
    const m = new THREE.Matrix4(), c = new THREE.Color()
    items.forEach((it, i) => {
      const y = heightAt(it.x, it.y) + (it.z ?? 0) + (base === 'bottom' ? it.h / 2 : 0)
      m.compose(new THREE.Vector3(it.x, y, -it.y), q.setFromAxisAngle(yAxis, it.rot), new THREE.Vector3(it.w, it.h, it.d))
      mesh.setMatrixAt(i, m)
      if (color && it.color) mesh.setColorAt(i, c.set(it.color))
    })
    mesh.count = items.length
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [items, shown, base, color])
  return <instancedMesh ref={ref} args={[geo, mat, Math.max(1, items.length)]} castShadow={shadow} receiveShadow={receive} />
}

export function Dressing() {
  const sv = useUi((st) => st.siteVersion)
  const L = useMemo(() => layout(), [sv])
  const g = useMemo(() => {
    const box = rbox(1, 1, 1, 0.04)
    const sharp = new THREE.BoxGeometry(1, 1, 1)
    const cone = new THREE.ConeGeometry(0.5, 1, 10)
    const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 14)
    const heap = heapGeometry()
    const apron = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
    const fence = new THREE.PlaneGeometry(1, 1)
    const car = mergeGeometries([rbox(4.4, 0.75, 1.8, 0.25).clone().translate(0, 0.55, 0), rbox(2.4, 0.6, 1.62, 0.25).clone().translate(-0.2, 1.15, 0)])!
    return { box, sharp, cone, cyl, heap, fence, car, apron }
  }, [])
  return (
    <group>
      <Inst items={L.cabin} geo={g.sharp} mat={mats.cabin} />
      <Inst items={L.container} geo={g.sharp} mat={mats.container} color />
      <Inst items={L.wood} geo={g.sharp} mat={mats.wood} />
      <Inst items={L.ply} geo={g.box} mat={mats.ply} />
      <Inst items={L.bags} geo={g.box} mat={mats.bags} />
      <Inst items={L.rebar} geo={g.sharp} mat={mats.rebar} />
      <Inst items={L.board} geo={g.sharp} mat={mats.board} />
      <Inst items={L.tube} geo={g.sharp} mat={mats.tube} />
      <Inst items={[...L.stone, ...L.sand, ...L.topsoil].map((h) => ({ ...h, w: h.w * 1.35, d: h.d * 1.35, h: 0.02, z: 0.04 }))} geo={g.apron} mat={mats.apron} shadow={false} receive={false} />
      <Inst items={L.stone} geo={g.heap} mat={mats.stone} receive={false} />
      <Inst items={L.sand} geo={g.heap} mat={mats.sand} receive={false} />
      <Inst items={L.topsoil} geo={g.heap} mat={mats.topsoil} receive={false} />
      <Inst items={L.cone} geo={g.cone} mat={mats.cone} />
      <Inst items={L.pile} geo={g.cyl} mat={mats.pile} shadow={false} />
      <Inst items={L.fence} geo={g.fence} mat={mats.fence} />
      <Inst items={L.car} geo={g.car} mat={mats.car} color base="centre" />
    </group>
  )
}

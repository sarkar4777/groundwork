import * as THREE from 'three'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { hot } from '../../live/hot'
import { useUi } from '../../live/store'
import type { Vec2 } from '../../proto/types'
import { dimWithNervous, rbox } from '../materials'
import { heightAt } from './heights'

interface Item { x: number; y: number; z?: number; w: number; h: number; d: number; rot: number; color: string }

let s = 41
const r = () => ((s = (s * 16807) % 2147483647) / 2147483647)

const bbox = (p: Vec2[]) => {
  const xs = p.map((q) => q[0]), ys = p.map((q) => q[1])
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
}

function layout(): { boxes: Item[]; cones: Item[]; piles: Item[]; heaps: Item[] } {
  s = 41
  const site = hot.site
  const boxes: Item[] = [], cones: Item[] = [], piles: Item[] = [], heaps: Item[] = []
  const cabin = site?.zones.find((z) => z.kind === 'walkway' || /cabin|welfare/i.test(z.label))
  const cb = cabin ? bbox(cabin.polygon) : { x0: -94, x1: -66, y0: -94, y1: -72 }
  // two-high welfare cabins with a stair tower
  for (let i = 0; i < 3; i++) {
    for (let lvl = 0; lvl < 2; lvl++) {
      boxes.push({ x: cb.x0 + 5.5, y: cb.y0 + 3 + i * 3.2, z: lvl * 2.9, w: 9.6, h: 2.8, d: 2.9, rot: 0, color: lvl ? '#e9edf0' : '#2f5d9a' })
    }
  }
  boxes.push({ x: cb.x0 + 12, y: cb.y0 + 6, w: 2.4, h: 5.8, d: 2.4, rot: 0, color: '#ffb020' })
  boxes.push({ x: cb.x1 - 6, y: cb.y1 - 4, w: 6.1, h: 2.6, d: 2.44, rot: 0.1, color: '#3e6b4f' })
  boxes.push({ x: cb.x1 - 6, y: cb.y1 - 8, w: 6.1, h: 2.6, d: 2.44, rot: 0.05, color: '#9a4b32' })
  for (let i = 0; i < 4; i++) boxes.push({ x: cb.x1 - 3 - i * 1.5, y: cb.y0 + 2, w: 1.2, h: 2.3, d: 1.2, rot: 0, color: '#2f8f5b' })
  // parked staff cars by the cabins
  for (let i = 0; i < 6; i++) boxes.push({ x: cb.x0 + 3 + i * 2.8, y: cb.y1 + 4, w: 1.8, h: 1.45, d: 4.4, rot: 0, color: ['#d8dde2', '#2c3440', '#8a1f2a', '#41566e', '#cfcfcf', '#1c1f24'][i] })
  // laydown: rebar bundles and formwork stacks
  const lay = site?.zones.find((z) => /laydown/i.test(z.label))
  if (lay) {
    const b = bbox(lay.polygon)
    for (let i = 0; i < 6; i++) boxes.push({ x: b.x0 + 4 + i * 2.2, y: (b.y0 + b.y1) / 2 + 3, w: 1.3, h: 0.7, d: 11, rot: 0, color: '#6b4a34' })
    for (let i = 0; i < 4; i++) boxes.push({ x: b.x1 - 5 - (i % 2) * 5, y: b.y0 + 4 + Math.floor(i / 2) * 4, w: 4.2, h: 0.9 + r() * 0.8, d: 2.6, rot: 0, color: '#b08a5a' })
    boxes.push({ x: b.x1 - 4, y: b.y1 - 3, w: 6, h: 1.2, d: 2.5, rot: 0, color: '#8b939c' })
  }
  // aggregate heaps by the gate
  const gate = site?.gate ?? [0, -98]
  heaps.push({ x: gate[0] - 30, y: gate[1] + 10, w: 5, h: 2.4, d: 5, rot: 0, color: '#d6d0c4' })
  heaps.push({ x: gate[0] - 40, y: gate[1] + 11, w: 4, h: 2, d: 4, rot: 0, color: '#b39c84' })
  heaps.push({ x: gate[0] + 34, y: gate[1] + 10, w: 5, h: 2.6, d: 5, rot: 0, color: '#cfc9bd' })
  // cones along the haul roads near the gate and around the pit edge
  for (const rd of site?.haulRoads ?? []) {
    for (let i = 1; i < rd.points.length; i++) {
      const [ax, ay] = rd.points[i - 1], [bx, by] = rd.points[i]
      const len = Math.hypot(bx - ax, by - ay)
      const nx = -(by - ay) / len, ny = (bx - ax) / len
      for (let t = 4; t < len; t += 9) {
        for (const side of [-1, 1]) {
          const k = t / len
          cones.push({ x: ax + (bx - ax) * k + nx * side * 6.5, y: ay + (by - ay) * k + ny * side * 6.5, w: 0.4, h: 0.75, d: 0.4, rot: 0, color: '#ff6a1a' })
        }
      }
    }
  }
  // pile caps along the wall the rig is working
  const pileZone = site?.zones.find((z) => /pil/i.test(z.label))
  if (pileZone) {
    const b = bbox(pileZone.polygon)
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2
    for (let i = -6; i <= 6; i++) if (Math.abs(i) > 1) piles.push({ x: cx, y: cy + i * 3.2, w: 0.9, h: 0.25, d: 0.9, rot: 0, color: '#bdb8ae' })
  }
  return { boxes, cones, piles, heaps }
}

const boxMat = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.1 })
const coneMat = new THREE.MeshStandardMaterial({ color: '#ff6a1a', roughness: 0.6 })
const pileMat = new THREE.MeshStandardMaterial({ color: '#bdb8ae', roughness: 0.9 })
const heapMat = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true })
dimWithNervous(boxMat, coneMat, pileMat, heapMat)

function useInst(ref: React.RefObject<THREE.InstancedMesh>, items: Item[], color: boolean) {
  useLayoutEffect(() => {
    const m = ref.current
    if (!m) return
    const mat = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color()
    items.forEach((it, i) => {
      const gz = heightAt(it.x, it.y)
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rot)
      mat.compose(new THREE.Vector3(it.x, gz + (it.z ?? 0) + it.h / 2, -it.y), q, new THREE.Vector3(it.w, it.h, it.d))
      m.setMatrixAt(i, mat)
      if (color) m.setColorAt(i, c.set(it.color))
    })
    m.count = items.length
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  })
}

export function Dressing() {
  const sv = useUi((st) => st.siteVersion)
  const shown = useUi((st) => st.terrainShown)
  const items = useMemo(() => layout(), [sv])
  void shown
  const boxes = useRef<THREE.InstancedMesh>(null!)
  const cones = useRef<THREE.InstancedMesh>(null!)
  const piles = useRef<THREE.InstancedMesh>(null!)
  const heaps = useRef<THREE.InstancedMesh>(null!)
  useInst(boxes, items.boxes, true)
  useInst(cones, items.cones, false)
  useInst(piles, items.piles, false)
  useInst(heaps, items.heaps, true)
  const unit = useMemo(() => rbox(1, 1, 1, 0.06), [])
  return (
    <group>
      <instancedMesh ref={boxes} args={[unit, boxMat, 80]} castShadow receiveShadow />
      <instancedMesh ref={cones} args={[undefined, coneMat, 200]} castShadow>
        <coneGeometry args={[0.5, 1, 8]} />
      </instancedMesh>
      <instancedMesh ref={piles} args={[undefined, pileMat, 20]} receiveShadow>
        <cylinderGeometry args={[0.5, 0.5, 1, 14]} />
      </instancedMesh>
      <instancedMesh ref={heaps} args={[undefined, heapMat, 8]} castShadow receiveShadow>
        <coneGeometry args={[1, 1, 9, 3]} />
      </instancedMesh>
    </group>
  )
}

import * as THREE from 'three'
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import { hot, interpAlpha, machineAt } from '../live/hot'
import { useUi } from '../live/store'
import type { Machine, SiteLayout, Vec2 } from '../proto/types'
import { heightAt } from './ground/heights'
import { craneRig } from './machines/Cranes'
import { COLORS } from './materials'

const LIFT = 0.35

function drape(pts: Vec2[], closed: boolean, step = 3): THREE.Vector3[] {
  const out: THREE.Vector3[] = []
  const list = closed ? [...pts, pts[0]] : pts
  for (let i = 0; i < list.length - 1; i++) {
    const [x0, y0] = list[i], [x1, y1] = list[i + 1]
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step))
    for (let k = 0; k < n; k++) {
      const x = x0 + ((x1 - x0) * k) / n, y = y0 + ((y1 - y0) * k) / n
      out.push(new THREE.Vector3(x, heightAt(x, y) + LIFT, -y))
    }
  }
  const [lx, ly] = list[list.length - 1]
  out.push(new THREE.Vector3(lx, heightAt(lx, ly) + LIFT, -ly))
  return out
}

const zoneColor = (kind: string) => (/excl|no.?go|danger/i.test(kind) ? COLORS.red : /walk|cabin|welfare/i.test(kind) ? COLORS.mint : COLORS.sky)

function Geofences({ site, depthTest, rev }: { site: SiteLayout; depthTest: boolean; rev: number }) {
  const zones = useMemo(
    () =>
      site.zones.map((z) => {
        const shape = new THREE.Shape(z.polygon.map(([x, y]) => new THREE.Vector2(x, y)))
        const g = new THREE.ShapeGeometry(shape)
        g.rotateX(-Math.PI / 2)
        const pos = g.attributes.position as THREE.BufferAttribute
        for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), -pos.getZ(i)) + LIFT * 0.5)
        return { z, pts: drape(z.polygon, true), fill: g }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [site, rev],
  )
  return (
    <group>
      {zones.map(({ z, pts, fill }) => {
        const c = zoneColor(z.kind)
        const excl = c === COLORS.red
        return (
          <group key={z.id}>
            <mesh geometry={fill} renderOrder={2}>
              <meshBasicMaterial color={c} transparent opacity={excl ? 0.13 : 0.05} depthWrite={false} depthTest={depthTest} />
            </mesh>
            <Line points={pts} color={c} lineWidth={excl ? 2.2 : 1.6} dashed={!excl} dashSize={2.5} gapSize={1.6} transparent opacity={0.95} depthTest={depthTest} renderOrder={3} />
          </group>
        )
      })}
    </group>
  )
}

function Roads({ site, depthTest, rev }: { site: SiteLayout; depthTest: boolean; rev: number }) {
  const roads = useMemo(() => site.haulRoads.map((r) => ({ r, pts: drape(r.points, false, 2) })), [site, rev])
  return (
    <group>
      {roads.map(({ r, pts }) => (
        <Line key={r.id} points={pts} color={COLORS.ice} lineWidth={1.4} dashed dashSize={4} gapSize={3} transparent opacity={0.85} depthTest={depthTest} renderOrder={3} />
      ))}
    </group>
  )
}

const ringGeo = new THREE.RingGeometry(0.965, 1, 96)
const discGeo = new THREE.CircleGeometry(1, 96)
const ringMat = () => new THREE.MeshBasicMaterial({ color: COLORS.mint, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })

export const swingR = () => hot.site?.swingRadius ?? 9.8

function SwingRing({ id }: { id: string }) {
  const g = useRef<THREE.Group>(null!)
  const ring = useMemo(ringMat, [])
  const outer = useMemo(ringMat, [])
  const disc = useMemo(() => new THREE.MeshBasicMaterial({ color: COLORS.mint, transparent: true, opacity: 0.08, depthWrite: false, toneMapped: false }), [])
  const m = useMemo(() => ({ joints: {} }) as Machine, [])
  const col = useMemo(() => new THREE.Color(), [])
  useFrame(() => {
    const s = machineAt(id, m, interpAlpha())
    if (!s) return
    g.current.position.set(s.x, heightAt(s.x, s.y) + LIFT, -s.y)
    const stopped = hot.curr?.safety.active_stops.some((a) => a.machine === id)
    const R = swingR()
    const warn = hot.curr?.workers.some((w) => w.zone !== 'ok' && Math.hypot(w.x - s.x, w.y - s.y) < R + 6)
    const t = performance.now()
    const pulse = stopped ? 0.5 + 0.5 * Math.sin(t / 110) : 0
    col.set(stopped ? COLORS.red : warn ? COLORS.amber : COLORS.mint)
    if (stopped) col.multiplyScalar(1.6 + pulse)
    ring.color.copy(col)
    outer.color.copy(col)
    disc.color.copy(col)
    disc.opacity = stopped ? 0.18 + pulse * 0.14 : warn ? 0.1 : 0.05
    outer.opacity = stopped ? 0.9 * (1 - ((t / 900) % 1)) : 0.35
    const sc = stopped ? R * (1 + ((t / 900) % 1) * 0.6) : R + 3
    g.current.children[0].scale.setScalar(R)
    g.current.children[1].scale.setScalar(R)
    g.current.children[2].scale.setScalar(sc)
  })
  return (
    <group ref={g} rotation={[0, 0, 0]}>
      <mesh geometry={ringGeo} material={ring} rotation={[-Math.PI / 2, 0, 0]} renderOrder={4} />
      <mesh geometry={discGeo} material={disc} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3} />
      <mesh geometry={ringGeo} material={outer} rotation={[-Math.PI / 2, 0, 0]} renderOrder={4} />
    </group>
  )
}

const segDist = (a: Vec2, b: Vec2, c: Vec2, d: Vec2) => {
  const pd = (p: Vec2, s0: Vec2, s1: Vec2) => {
    const vx = s1[0] - s0[0], vy = s1[1] - s0[1]
    const t = Math.max(0, Math.min(1, ((p[0] - s0[0]) * vx + (p[1] - s0[1]) * vy) / (vx * vx + vy * vy || 1)))
    return Math.hypot(p[0] - s0[0] - vx * t, p[1] - s0[1] - vy * t)
  }
  return Math.min(pd(a, c, d), pd(b, c, d), pd(c, a, b), pd(d, a, b))
}

// Crane slew envelopes glow red when the two jibs come within the separation margin.
export const craneConflict = { on: false, dist: 99 }

function CraneEnvelopes() {
  const g = useRef<THREE.Group>(null!)
  const mats = useMemo(() => [0, 1].map(() => ({ ring: ringMat(), sector: new THREE.MeshBasicMaterial({ color: COLORS.amber, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }) })), [])
  const sectorGeo = useMemo(() => new THREE.CircleGeometry(1, 24, -0.14, 0.28), [])
  useFrame(() => {
    const ids = [...craneRig.keys()].slice(0, 2)
    const rigs = ids.map((id) => craneRig.get(id)!)
    let conflict = false
    let dist = 99
    if (rigs.length === 2) {
      const seg = (r: (typeof rigs)[0]): [Vec2, Vec2] => [[r.base.x, -r.base.z], [r.hook.x, -r.hook.z]]
      const [a0, a1] = seg(rigs[0]), [b0, b1] = seg(rigs[1])
      dist = segDist(a0, a1, b0, b1)
      const rule = hot.curr?.safety.active_stops.some((s) => /envelope|collision|overlap|anti/i.test(s.rule))
      conflict = dist < 8 || !!rule
    }
    craneConflict.on = conflict
    craneConflict.dist = dist
    const t = performance.now()
    g.current.children.forEach((child, i) => {
      const r = rigs[i]
      child.visible = !!r
      if (!r) return
      const env = (hot.site?.craneBases.find((c) => c.id === ids[i])?.radius ?? r.radius) || r.radius
      child.position.set(r.base.x, r.base.y + 0.5, r.base.z)
      const [ringMesh, sectorMesh] = child.children as THREE.Mesh[]
      ringMesh.scale.setScalar(env)
      sectorMesh.scale.setScalar(Math.max(4, r.radius + 3))
      sectorMesh.rotation.z = r.slew
      const m = mats[i]
      const glow = conflict ? 1.8 + Math.sin(t / 120) * 0.6 : 1
      m.ring.color.set(conflict ? COLORS.red : COLORS.amber).multiplyScalar(glow)
      m.ring.opacity = conflict ? 1 : 0.55
      m.sector.color.set(conflict ? COLORS.red : COLORS.amber).multiplyScalar(glow)
      m.sector.opacity = conflict ? 0.32 : 0.14
    })
  })
  return (
    <group ref={g}>
      {mats.map((m, i) => (
        <group key={i}>
          <mesh geometry={ringGeo} material={m.ring} rotation={[-Math.PI / 2, 0, 0]} renderOrder={4} />
          <group rotation={[-Math.PI / 2, 0, 0]}>
            <mesh geometry={sectorGeo} material={m.sector} renderOrder={3} />
          </group>
        </group>
      ))}
    </group>
  )
}

// Abenix ML worker path prediction: where each tag is expected 1, 2 and 3 s ahead.
function WorkerPredictions() {
  const CAP = 64
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CAP * 2 * 3), 3))
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(CAP * 2 * 3), 3))
    return g
  }, [])
  const ptsGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CAP * 3), 3))
    return g
  }, [])
  const ice = useMemo(() => new THREE.Color(COLORS.ice), [])
  const amber = useMemo(() => new THREE.Color(COLORS.amber), [])
  useFrame(() => {
    const pos = geo.attributes.position.array as Float32Array
    const col = geo.attributes.color.array as Float32Array
    const pp = ptsGeo.attributes.position.array as Float32Array
    let n = 0, m = 0
    for (const w of hot.curr?.workers ?? []) {
      if (!w.predicted?.length) continue
      let px = w.x, py = w.y
      const c = w.zone === 'ok' ? ice : amber
      for (const [x, y] of w.predicted) {
        if (n >= CAP) break
        pos.set([px, heightAt(px, py) + 0.4, -py, x, heightAt(x, y) + 0.4, -y], n * 6)
        col.set([c.r, c.g, c.b, c.r, c.g, c.b], n * 6)
        n++
        px = x
        py = y
      }
      if (m < CAP) pp.set([px, heightAt(px, py) + 0.4, -py], m++ * 3)
    }
    geo.setDrawRange(0, n * 2)
    ptsGeo.setDrawRange(0, m)
    geo.attributes.position.needsUpdate = true
    geo.attributes.color.needsUpdate = true
    ptsGeo.attributes.position.needsUpdate = true
  })
  return (
    <group renderOrder={6}>
      <lineSegments geometry={geo} frustumCulled={false}>
        <lineBasicMaterial vertexColors transparent opacity={0.9} depthTest={false} toneMapped={false} />
      </lineSegments>
      <points geometry={ptsGeo} frustumCulled={false}>
        <pointsMaterial color={COLORS.ice} size={5} sizeAttenuation={false} transparent opacity={0.95} depthTest={false} toneMapped={false} />
      </points>
    </group>
  )
}

export function Overlays() {
  const ov = useUi((s) => s.overlays)
  const cam = useUi((s) => s.cam)
  const ex = useUi((s) => s.state?.machines.filter((m) => /excav/i.test(m.kind)).map((m) => m.id).join('|') ?? '')
  const [site, rev] = useSiteRev()
  const depthTest = cam !== 'drone'
  const hero = useUi((s) => s.heroFx)
  if (cam === 'nervous' || hero) return null
  return (
    <group>
      {site && ov.geofence && <Geofences site={site} depthTest={depthTest} rev={rev} />}
      {site && ov.roads && <Roads site={site} depthTest={depthTest} rev={rev} />}
      {ov.swing && ex.split('|').filter(Boolean).map((id) => <SwingRing key={id} id={id} />)}
      {ov.crane && <CraneEnvelopes />}
      {ov.workers && <WorkerPredictions />}
    </group>
  )
}

// Rebuild draped overlays when the site layout or the terrain revision changes.
function useSiteRev(): [SiteLayout | null, number] {
  const shown = useUi((s) => s.terrainShown)
  const sv = useUi((s) => s.siteVersion)
  return [hot.site, shown * 1000 + sv]
}

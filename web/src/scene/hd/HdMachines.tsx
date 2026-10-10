import * as THREE from 'three'
import { useMemo, useRef } from 'react'
import { HD, fleetDecal, stripeDecal } from './hdMaterials'
import { Kit, shared } from './kit'
import { useMachineDrive } from '../machines/common'

// Machines at photographic detail for the real ground. Dimensions follow real machines of each class,
// and every joint the twin reports drives the same pivot as the rendered-site models.

type V3 = [number, number, number]
const P = Math.PI

// ---------- shared parts

function tyre(k: Kit, r: number, w: number, pos: V3) {
  k.cyl(HD.rubber, r, w, pos, [P / 2, 0, 0], 28, r, false, [6, 1])
  k.cyl(HD.rim, r * 0.58, w + 0.02, pos, [P / 2, 0, 0], 16)
  k.cyl(HD.steel, r * 0.2, w + 0.06, pos, [P / 2, 0, 0], 10)
}

function trackLoop(k: Kit, len: number, h: number, w: number, z: number, y = h / 2) {
  k.box(HD.track, [len, h, w], [0, y, z], [0, 0, 0], h * 0.46, [1, len / 1.6])
  k.box(HD.frame, [len * 0.78, h * 0.55, w * 0.5], [0, y + 0.02, z - Math.sign(z) * w * 0.45], [0, 0, 0], 0.06)
  k.cyl(HD.wornSteel, h * 0.42, w * 0.55, [len / 2 - h * 0.45, y, z], [P / 2, 0, 0], 14)
  k.cyl(HD.wornSteel, h * 0.42, w * 0.55, [-len / 2 + h * 0.45, y, z], [P / 2, 0, 0], 14)
}

// A cab with pillars, glass, roof, a seat and a guard, its floor at y = 0, centred.
function cab(k: Kit, L: number, W: number, H: number, pos: V3, opts: { roofMat?: THREE.Material; guard?: boolean } = {}) {
  const [x, y, z] = pos
  k.box(HD.paint, [L, 0.42, W], [x, y + 0.21, z], [0, 0, 0], 0.06)
  k.box(HD.glass, [L - 0.06, H - 0.55, W - 0.06], [x, y + 0.42 + (H - 0.55) / 2, z], [0, 0, 0], 0.03)
  const pil = 0.07
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]])
    k.box(HD.paint, [pil, H - 0.42, pil], [x + sx * (L / 2 - pil / 2), y + 0.42 + (H - 0.42) / 2, z + sz * (W / 2 - pil / 2)], [0, 0, 0], 0.01)
  k.box(HD.paint, [pil, H - 0.42, W - 0.1], [x - L / 2 + pil / 2, y + 0.42 + (H - 0.42) / 2, z], [0, 0, 0], 0.01)
  k.box(opts.roofMat ?? HD.paint, [L + 0.08, 0.09, W + 0.08], [x, y + H, z], [0, 0, 0], 0.03)
  k.box(HD.seat, [0.45, 0.5, 0.45], [x - 0.05, y + 0.65, z], [0, 0, 0], 0.08)
  if (opts.guard) for (let i = -2; i <= 2; i++) k.rod(HD.black, 0.018, [x + L / 2 + 0.06, y + 0.5, z + i * W * 0.18], [x + L / 2 + 0.06, y + H - 0.1, z + i * W * 0.18])
  k.box(HD.light, [0.12, 0.08, 0.18], [x + L / 2 - 0.05, y + H + 0.08, z - W / 3], [0, 0, 0], 0.02)
  k.box(HD.light, [0.12, 0.08, 0.18], [x + L / 2 - 0.05, y + H + 0.08, z + W / 3], [0, 0, 0], 0.02)
}

function mirror(k: Kit, base: V3, arm: V3) {
  k.rod(HD.black, 0.02, base, arm)
  k.box(HD.black, [0.05, 0.28, 0.18], arm, [0, 0, 0], 0.02)
}

function beacon(k: Kit, pos: V3) {
  k.cyl(HD.black, 0.08, 0.05, pos)
  k.cyl(HD.beacon, 0.07, 0.12, [pos[0], pos[1] + 0.08, pos[2]], [0, 0, 0], 12)
}

// Soil heaped in a body, a bell of noise-roughened ground, scaled by the load.
function soilHeap(len: number, wid: number, h: number) {
  const g = new THREE.PlaneGeometry(len, wid, 28, 14)
  g.rotateX(-P / 2)
  const p = g.attributes.position as THREE.BufferAttribute
  let seed = 3
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) / (len / 2), v = p.getZ(i) / (wid / 2)
    const bell = Math.max(0, 1 - u * u) * Math.max(0, 1 - v * v)
    p.setY(i, h * Math.pow(bell, 0.7) + (rnd() - 0.5) * 0.12 * bell)
  }
  g.computeVertexNormals()
  return g
}

// Hydraulic cylinder between two moving anchors: a painted barrel and a chrome rod.
function useRam() {
  return useMemo(() => {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 14), HD.paint)
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10), HD.chrome)
    barrel.castShadow = rod.castShadow = true
    return { barrel, rod }
  }, [])
}

const va = new THREE.Vector3(), vb = new THREE.Vector3(), vm = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3()
function placeRam(r: { barrel: THREE.Mesh; rod: THREE.Mesh }, a: THREE.Object3D, b: THREE.Object3D, rb: number) {
  const parent = r.barrel.parent
  if (!parent) return
  a.getWorldPosition(va)
  b.getWorldPosition(vb)
  parent.worldToLocal(va)
  parent.worldToLocal(vb)
  const len = va.distanceTo(vb)
  dir.copy(vb).sub(va).normalize()
  const q = new THREE.Quaternion().setFromUnitVectors(up, dir)
  const bl = Math.min(len * 0.62, 2.4)
  vm.copy(va).addScaledVector(dir, bl / 2)
  r.barrel.position.copy(vm)
  r.barrel.quaternion.copy(q)
  r.barrel.scale.set(rb, bl, rb)
  const rl = len - bl * 0.85
  vm.copy(vb).addScaledVector(dir, -rl / 2)
  r.rod.position.copy(vm)
  r.rod.quaternion.copy(q)
  r.rod.scale.set(rb * 0.52, Math.max(0.01, rl), rb * 0.52)
}

// ---------- excavator, 20 t class

const BOOM_L = 5.7
const STICK_L = 2.9
const APEX_X = 3.0
const APEX_Y = 0.85
const SEG1_A = Math.atan2(APEX_Y, APEX_X)
const SEG1_L = Math.hypot(APEX_X, APEX_Y)
const SEG2_A = Math.atan2(-APEX_Y, BOOM_L - APEX_X)
const SEG2_L = Math.hypot(BOOM_L - APEX_X, APEX_Y)

const exUnder = () => {
  const k = new Kit()
  trackLoop(k, 4.45, 0.9, 0.6, 1.1)
  trackLoop(k, 4.45, 0.9, 0.6, -1.1)
  k.box(HD.frame, [1.8, 0.55, 1.7], [0, 0.85, 0], [0, 0, 0], 0.1)
  k.cyl(HD.frame, 0.95, 0.24, [0, 1.2, 0], [0, 0, 0], 28)
  return k.build('ex-under')
}

const exUpper = (id: string) => {
  const k = new Kit()
  k.box(HD.frame, [4.6, 0.32, 2.5], [-0.5, 0.16, 0], [0, 0, 0], 0.06)
  // counterweight, curved round the tail
  k.arc(HD.paint, 1.92, 2.62, P * 0.84, P * 1.16, 0.95, [0, 0.32, 0])
  k.quad(stripeDecal(), 1.5, 0.22, [-2.66, 0.95, 0], [0, -P / 2, 0])
  // engine hood with grilles and the exhaust
  k.box(HD.paint, [1.55, 0.85, 2.38], [-1.35, 0.74, 0], [0, 0, 0], 0.12)
  k.box(HD.grille, [0.9, 0.04, 0.9], [-1.4, 1.18, -0.55], [0, 0, 0], 0.01)
  k.box(HD.grille, [0.5, 0.04, 0.7], [-1.6, 1.18, 0.6], [0, 0, 0], 0.01)
  k.cyl(HD.black, 0.075, 0.55, [-1.05, 1.42, 0.62])
  k.cyl(HD.black, 0.09, 0.08, [-1.05, 1.72, 0.62])
  // right deck: tanks and toolbox under a walkway
  k.box(HD.paint, [1.7, 0.82, 0.88], [0.3, 0.73, 0.78], [0, 0, 0], 0.08)
  k.box(HD.plate, [1.7, 0.04, 0.88], [0.3, 1.16, 0.78], [0, 0, 0], 0.01)
  k.cyl(HD.black, 0.12, 0.08, [0.75, 1.2, 1.0])
  // handrails
  k.tube(HD.paint, 0.025, [[-0.6, 1.2, 1.2], [-0.6, 1.62, 1.2], [1.0, 1.62, 1.2], [1.0, 1.2, 1.2]], 20)
  k.tube(HD.paint, 0.025, [[-2.0, 1.2, 1.05], [-2.0, 1.55, 1.05], [-0.9, 1.55, 1.05]], 12)
  // cab, front left
  cab(k, 1.55, 1.0, 1.62, [0.35, 0.32, -0.72], { guard: true })
  mirror(k, [1.0, 1.6, -1.2], [1.15, 1.75, -1.35])
  mirror(k, [0.9, 1.4, 1.2], [1.05, 1.55, 1.32])
  beacon(k, [-0.1, 2.05, -0.95])
  // boom foot bosses
  k.cyl(HD.frame, 0.28, 0.9, [1.6, 0.95, 0.35], [P / 2, 0, 0], 16)
  k.quad(fleetDecal(id), 1.0, 0.5, [-1.35, 1.175, -0.1], [-P / 2, 0, P / 2])
  k.quad(fleetDecal(id), 0.9, 0.45, [0.35, 0.95, -1.226], [0, P, 0])
  return k.build('ex-upper')
}

const exBoom = () => {
  const k = new Kit()
  k.taper(HD.paintArm, SEG1_L + 0.25, 0.78, 0.62, 0.66, 0.58, [-0.1, 0, 0], [0, 0, SEG1_A])
  k.taper(HD.paintArm, SEG2_L + 0.2, 0.64, 0.56, 0.46, 0.5, [APEX_X - 0.1, APEX_Y, 0], [0, 0, SEG2_A])
  k.cyl(HD.frame, 0.2, 0.75, [APEX_X, APEX_Y - 0.1, 0], [P / 2, 0, 0], 12)
  k.cyl(HD.frame, 0.16, 0.62, [BOOM_L, 0, 0], [P / 2, 0, 0], 12)
  for (const z of [0.16, -0.16]) k.tube(HD.black, 0.032, [[0.3, 0.5, z], [APEX_X, APEX_Y + 0.42, z], [BOOM_L - 0.3, 0.32, z]], 20)
  k.box(HD.light, [0.14, 0.1, 0.22], [1.6, 0.7, -0.3], [0, 0, SEG1_A], 0.02)
  return k.build('ex-boom')
}

const exStick = () => {
  const k = new Kit()
  k.taper(HD.paintArm, STICK_L + 0.5, 0.56, 0.44, 0.4, 0.36, [-0.45, 0, 0])
  k.cyl(HD.frame, 0.14, 0.5, [STICK_L, 0, 0], [P / 2, 0, 0], 12)
  k.tube(HD.black, 0.03, [[-0.2, 0.32, 0.12], [1.2, 0.3, 0.12], [2.6, 0.2, 0.12]], 12)
  return k.build('ex-stick')
}

const exBucket = () => {
  const k = new Kit()
  k.shell(HD.sheet, 0.62, 1.25, P * 1.25, P * 2.25, [0.48, -0.25, 0], [0, 0, 0], 16)
  for (const z of [0.62, -0.62]) k.box(HD.wornSteel, [1.1, 1.0, 0.05], [0.45, -0.25, z], [0, 0, -0.15], 0.02)
  k.box(HD.wornSteel, [0.3, 0.3, 0.6], [0.05, 0.05, 0], [0, 0, 0], 0.04)
  for (let i = -2; i <= 2; i++) k.taper(HD.wornSteel, 0.24, 0.1, 0.12, 0.03, 0.05, [0.92, -0.86, i * 0.26], [0, 0, -0.55])
  return k.build('ex-bucket')
}

export function HdExcavator({ id }: { id: string }) {
  const root = useRef<THREE.Group>(null!)
  const upper = useRef<THREE.Group>(null!)
  const boom = useRef<THREE.Group>(null!)
  const stick = useRef<THREE.Group>(null!)
  const bucket = useRef<THREE.Group>(null!)
  const soil = useRef<THREE.Mesh>(null!)
  const a = useRef<THREE.Object3D[]>([])
  const rams = [useRam(), useRam(), useRam()]
  const parts = useMemo(
    () => ({ under: shared('ex-under', exUnder), upper: exUpper(id), boom: shared('ex-boom', exBoom), stick: shared('ex-stick', exStick), bucket: shared('ex-bucket', exBucket) }),
    [id],
  )
  const heap = useMemo(() => soilHeap(1.0, 1.1, 0.42), [])
  const reg = (i: number) => (o: THREE.Object3D | null) => {
    if (o) a.current[i] = o
  }
  useMachineDrive(id, root, 4.8, 3.2, (m) => {
    const j = m.joints
    upper.current.rotation.y = j.swing ?? 0
    boom.current.rotation.z = j.boom ?? 0.3
    stick.current.rotation.z = (j.stick ?? 0.5) - 1.1
    bucket.current.rotation.z = -0.4 - (j.bucket ?? 0.3)
    soil.current.visible = m.load_t > 1
    const [b0, b1, s0, s1, k0, k1] = a.current
    placeRam(rams[0], b0, b1, 0.13)
    placeRam(rams[1], s0, s1, 0.12)
    placeRam(rams[2], k0, k1, 0.1)
  })
  return (
    <group ref={root}>
      <primitive object={parts.under} />
      <group ref={upper} position={[0, 1.35, 0]}>
        <primitive object={parts.upper} />
        <object3D ref={reg(0)} position={[0.95, 0.42, 0.35]} />
        <primitive object={rams[0].barrel} />
        <primitive object={rams[0].rod} />
        <primitive object={rams[1].barrel} />
        <primitive object={rams[1].rod} />
        <primitive object={rams[2].barrel} />
        <primitive object={rams[2].rod} />
        <group ref={boom} position={[1.6, 0.95, 0.35]}>
          <primitive object={parts.boom} />
          <group rotation={[0, 0, SEG1_A]}>
            <object3D ref={reg(1)} position={[SEG1_L * 0.7, -0.38, 0]} />
          </group>
          <group position={[APEX_X, APEX_Y, 0]} rotation={[0, 0, SEG2_A]}>
            <object3D ref={reg(2)} position={[0.3, 0.42, 0]} />
          </group>
          <group ref={stick} position={[BOOM_L, 0, 0]}>
            <primitive object={parts.stick} />
            <object3D ref={reg(3)} position={[-0.32, 0.36, 0]} />
            <object3D ref={reg(4)} position={[0.5, 0.3, 0]} />
            <group ref={bucket} position={[STICK_L, 0, 0]}>
              <primitive object={parts.bucket} />
              <object3D ref={reg(5)} position={[0.22, 0.42, 0]} />
              <mesh ref={soil} geometry={heap} material={HD.soil} position={[0.45, -0.32, 0]} rotation={[0, 0, -0.2]} castShadow />
            </group>
          </group>
        </group>
      </group>
    </group>
  )
}

// ---------- articulated haul truck, 30 t class

const truckFront = (id: string) => {
  const k = new Kit()
  k.box(HD.frame, [3.0, 0.42, 1.15], [0.3, 0.92, 0], [0, 0, 0], 0.06)
  k.taper(HD.paint, 2.15, 1.25, 2.05, 0.95, 1.8, [-0.2, 1.62, 0], [0, 0, 0], -0.12)
  k.box(HD.grille, [0.9, 0.04, 1.2], [1.0, 2.18, 0], [0, 0, -0.06], 0.01)
  k.box(HD.black, [0.25, 0.75, 1.9], [2.02, 1.35, 0], [0, 0, 0], 0.05)
  k.box(HD.grille, [0.04, 0.55, 1.2], [2.16, 1.42, 0], [0, 0, 0], 0.01)
  for (const z of [1.18, -1.18]) {
    k.shell(HD.paintSheet, 0.95, 0.7, P * 0.45, P * 1.55, [0.6, 0.8, z], [0, 0, 0], 16)
    k.box(HD.light, [0.06, 0.16, 0.3], [2.16, 1.62, z * 0.65], [0, 0, 0], 0.02)
  }
  cab(k, 1.35, 1.75, 1.7, [-0.55, 2.05, 0], { guard: false })
  mirror(k, [0.2, 3.0, 0.95], [0.45, 3.0, 1.25])
  mirror(k, [0.2, 3.0, -0.95], [0.45, 3.0, -1.25])
  k.cyl(HD.black, 0.08, 1.1, [0.35, 2.75, 0.72])
  beacon(k, [-0.8, 3.8, 0.55])
  tyre(k, 0.8, 0.62, [0.6, 0.8, 1.15])
  tyre(k, 0.8, 0.62, [0.6, 0.8, -1.15])
  k.quad(fleetDecal(id), 1.0, 0.5, [0.9, 2.22, 0], [-P / 2, 0, P / 2])
  return k.build('truck-front')
}

const truckRear = () => {
  const k = new Kit()
  k.box(HD.frame, [5.4, 0.45, 1.2], [-3.0, 1.0, 0], [0, 0, 0], 0.06)
  k.box(HD.frame, [0.9, 0.6, 0.9], [0.0, 1.1, 0], [0, 0, 0], 0.08)
  for (const x of [-2.6, -4.4]) for (const z of [1.15, -1.15]) tyre(k, 0.8, 0.62, [x, 0.8, z])
  for (const z of [1.18, -1.18]) k.box(HD.paint, [3.2, 0.1, 0.72], [-3.5, 1.72, z], [0, 0, 0], 0.03)
  return k.build('truck-rear')
}

const truckBody = () => {
  const k = new Kit()
  k.box(HD.wornSteel, [5.6, 0.18, 2.55], [2.8, 0.1, 0], [0, 0, 0], 0.03)
  for (const s of [1, -1]) {
    k.box(HD.paint, [5.6, 1.55, 0.1], [2.8, 0.88, s * 1.33], [s * 0.08, 0, 0], 0.03)
    for (const x of [0.9, 2.3, 3.7, 5.0]) k.box(HD.paint, [0.14, 1.4, 0.12], [x, 0.85, s * 1.42], [s * 0.08, 0, 0], 0.03)
    k.box(HD.paint, [5.7, 0.14, 0.2], [2.8, 1.68, s * 1.41], [0, 0, 0], 0.04)
  }
  k.box(HD.paint, [0.16, 1.95, 2.85], [5.55, 1.05, 0], [0, 0, 0], 0.04)
  k.box(HD.paint, [0.75, 0.1, 2.85], [5.95, 1.98, 0], [0, 0, -0.1], 0.03)
  k.box(HD.wornSteel, [0.6, 0.12, 2.5], [0.25, 0.25, 0], [0, 0, 0.35], 0.02)
  k.quad(stripeDecal(), 2.4, 0.26, [-0.02, 0.55, 0], [0, -P / 2, 0])
  return k.build('truck-body')
}

export function HdTruck({ id }: { id: string }) {
  const root = useRef<THREE.Group>(null!)
  const rear = useRef<THREE.Group>(null!)
  const body = useRef<THREE.Group>(null!)
  const load = useRef<THREE.Mesh>(null!)
  const parts = useMemo(() => ({ front: truckFront(id), rear: shared('truck-rear', truckRear), body: shared('truck-body', truckBody) }), [id])
  const heap = useMemo(() => soilHeap(5.0, 2.4, 1.15), [])
  useMachineDrive(id, root, 10, 2.9, (m, dt) => {
    body.current.rotation.z = (m.joints.body ?? m.joints.dump ?? m.joints.hoist ?? 0) * 0.9
    rear.current.rotation.y = -(m.joints.steer ?? m.joints.articulation ?? 0)
    load.current.visible = m.load_t > 2
    load.current.scale.y = Math.min(1, m.load_t / 24) * 0.85 + 0.15
    void dt
  })
  return (
    <group ref={root}>
      <group position={[3.2, 0, 0]}>
        <primitive object={parts.front} />
      </group>
      <group ref={rear} position={[1.6, 0, 0]}>
        <primitive object={parts.rear} />
        <group ref={body} position={[-5.7, 1.35, 0]}>
          <primitive object={parts.body} />
          <mesh ref={load} geometry={heap} material={HD.soil} position={[2.75, 0.2, 0]} castShadow receiveShadow />
        </group>
      </group>
    </group>
  )
}

// ---------- dozer, 20 t class

const dozerBody = (id: string) => {
  const k = new Kit()
  trackLoop(k, 3.6, 0.85, 0.56, 1.15)
  trackLoop(k, 3.6, 0.85, 0.56, -1.15)
  k.box(HD.frame, [3.0, 0.5, 1.6], [0, 0.95, 0], [0, 0, 0], 0.06)
  k.taper(HD.paint, 2.0, 1.15, 1.8, 0.9, 1.5, [-0.2, 1.65, 0], [0, 0, 0], -0.1)
  k.box(HD.grille, [0.9, 0.04, 0.9], [0.8, 2.13, 0], [0, 0, -0.05], 0.01)
  k.cyl(HD.black, 0.08, 0.9, [1.25, 2.45, -0.5])
  k.box(HD.paint, [1.4, 0.75, 2.3], [-0.95, 1.55, 0], [0, 0, 0], 0.08)
  cab(k, 1.35, 1.45, 1.5, [-0.95, 1.92, 0], { guard: false })
  beacon(k, [-1.4, 3.5, 0.55])
  // ripper at the back
  k.box(HD.frame, [0.25, 0.3, 1.9], [-1.95, 0.95, 0], [0, 0, 0], 0.04)
  k.box(HD.wornSteel, [0.12, 0.9, 0.12], [-2.15, 0.55, 0], [0, 0, 0.35], 0.02)
  for (const z of [0.95, -0.95]) k.box(HD.frame, [1.7, 0.2, 0.2], [1.6, 0.95, z], [0, 0, 0.1], 0.04)
  k.quad(fleetDecal(id), 0.9, 0.45, [0.4, 2.22, 0], [-P / 2, 0, P / 2])
  return k.build('dozer')
}

const dozerBlade = () => {
  const k = new Kit()
  k.shell(HD.paintSheet, 0.85, 3.85, P * 1.2, P * 1.8, [0.95, 0.05, 0], [0, 0, 0], 12)
  k.box(HD.wornSteel, [0.14, 0.1, 3.85], [0.47, -0.66, 0], [0, 0, 0.3], 0.02)
  for (const z of [1.92, -1.92]) k.box(HD.paint, [0.55, 1.2, 0.05], [0.3, 0.0, z], [0, 0, 0], 0.02)
  return k.build('dozer-blade')
}

export function HdDozer({ id }: { id: string }) {
  const root = useRef<THREE.Group>(null!)
  const blade = useRef<THREE.Group>(null!)
  const parts = useMemo(() => ({ body: dozerBody(id), blade: shared('dozer-blade', dozerBlade) }), [id])
  useMachineDrive(id, root, 4.2, 3.2, (m) => {
    blade.current.position.y = 0.62 + (m.joints.blade ?? 0) * 0.6
  })
  return (
    <group ref={root}>
      <primitive object={parts.body} />
      <group ref={blade} position={[2.25, 0.62, 0]}>
        <primitive object={parts.blade} />
      </group>
    </group>
  )
}

// ---------- single-drum roller, 12 t class

const rollerBody = (id: string) => {
  const k = new Kit()
  k.box(HD.paint, [1.8, 0.45, 2.35], [1.8, 1.5, 0], [0, 0, 0], 0.06)
  for (const z of [1.12, -1.12]) k.box(HD.paint, [1.4, 1.0, 0.1], [1.8, 1.1, z], [0, 0, 0], 0.03)
  k.box(HD.frame, [0.6, 0.6, 0.8], [0.75, 1.05, 0], [0, 0, 0], 0.06)
  k.taper(HD.paint, 2.6, 1.3, 1.9, 1.05, 1.7, [-2.2, 1.35, 0], [0, 0, 0])
  k.box(HD.grille, [0.9, 0.04, 1.1], [-1.4, 1.95, 0], [0, 0, 0], 0.01)
  tyre(k, 0.78, 0.6, [-1.3, 0.78, 1.0])
  tyre(k, 0.78, 0.6, [-1.3, 0.78, -1.0])
  for (const x of [0.15, -1.0]) for (const z of [0.85, -0.85]) k.box(HD.black, [0.08, 1.55, 0.08], [x, 2.75, z], [0, 0, 0], 0.01)
  k.box(HD.paint, [1.45, 0.1, 1.9], [-0.42, 3.55, 0], [0, 0, 0], 0.03)
  k.box(HD.seat, [0.5, 0.55, 0.5], [-0.45, 2.3, 0], [0, 0, 0], 0.08)
  beacon(k, [-0.4, 3.62, 0])
  k.quad(fleetDecal(id), 0.9, 0.45, [-1.6, 1.99, 0], [-P / 2, 0, P / 2])
  return k.build('roller')
}

export function HdRoller({ id }: { id: string }) {
  const root = useRef<THREE.Group>(null!)
  const drum = useRef<THREE.Mesh>(null!)
  const body = useMemo(() => rollerBody(id), [id])
  const drumGeo = useMemo(() => new THREE.CylinderGeometry(0.76, 0.76, 2.13, 32), [])
  useMachineDrive(id, root, 5.5, 2.3, (m) => {
    drum.current.rotation.y = -(m.joints.drum ?? 0)
  })
  return (
    <group ref={root}>
      <primitive object={body} />
      <mesh ref={drum} geometry={drumGeo} material={HD.steel} position={[1.8, 0.76, 0]} rotation={[P / 2, 0, 0]} castShadow receiveShadow />
    </group>
  )
}

// ---------- telehandler, 14 m class

const teleBody = (id: string) => {
  const k = new Kit()
  k.box(HD.paint, [4.6, 0.8, 1.7], [0, 1.15, 0], [0, 0, 0], 0.18)
  k.box(HD.grille, [1.0, 0.04, 0.8], [-1.6, 1.56, 0.4], [0, 0, 0], 0.01)
  for (const x of [1.5, -1.5]) for (const z of [1.05, -1.05]) tyre(k, 0.65, 0.52, [x, 0.65, z])
  for (const x of [1.5, -1.5]) for (const z of [1.05, -1.05]) k.shell(HD.paintSheet, 0.75, 0.55, P * 0.5, P * 1.5, [x, 0.65, z], [0, 0, 0], 12)
  cab(k, 1.55, 0.95, 1.65, [0.3, 1.55, -0.75], { guard: false })
  beacon(k, [0.3, 3.3, -0.75])
  k.quad(fleetDecal(id), 0.8, 0.4, [-1.3, 1.56, 0.35], [-P / 2, 0, P / 2])
  return k.build('tele')
}

export function HdTelehandler({ id }: { id: string }) {
  const root = useRef<THREE.Group>(null!)
  const boom = useRef<THREE.Group>(null!)
  const ext = useRef<THREE.Group>(null!)
  const parts = useMemo(() => {
    const b = new Kit()
    b.taper(HD.paintArm, 4.7, 0.55, 0.52, 0.48, 0.48, [-0.1, 0, 0])
    b.cyl(HD.frame, 0.2, 0.7, [0, 0, 0], [P / 2, 0, 0], 12)
    b.tube(HD.black, 0.03, [[0.3, 0.3, 0.2], [2.3, 0.28, 0.2], [4.3, 0.26, 0.2]], 10)
    const e = new Kit()
    e.box(HD.paintArm, [3.2, 0.4, 0.4], [-1.2, 0, 0], [0, 0, 0], 0.05)
    e.box(HD.frame, [0.14, 1.15, 1.35], [0.42, -0.3, 0], [0, 0, 0], 0.03)
    for (const z of [0.42, -0.42]) {
      e.box(HD.wornSteel, [1.25, 0.07, 0.14], [1.05, -0.84, z], [0, 0, 0], 0.01)
      e.box(HD.wornSteel, [0.07, 0.9, 0.14], [0.47, -0.42, z], [0, 0, 0], 0.01)
    }
    return { body: teleBody(id), boom: b.build('tele-boom'), ext: e.build('tele-ext') }
  }, [id])
  useMachineDrive(id, root, 5, 2.4, (m) => {
    boom.current.rotation.z = m.joints.boom ?? 0.2
    ext.current.position.x = 4.2 + (m.joints.extension ?? m.joints.extend ?? 0.3) * 3
  })
  return (
    <group ref={root}>
      <primitive object={parts.body} />
      <group ref={boom} position={[-1.8, 1.9, 0.35]}>
        <primitive object={parts.boom} />
        <group ref={ext} position={[4.2, 0, 0]}>
          <primitive object={parts.ext} />
        </group>
      </group>
    </group>
  )
}

// ---------- piling rig, 24 m mast

const pileBody = (id: string) => {
  const k = new Kit()
  trackLoop(k, 5.2, 0.95, 0.7, 1.4)
  trackLoop(k, 5.2, 0.95, 0.7, -1.4)
  k.box(HD.frame, [2.4, 0.5, 2.0], [0, 1.05, 0], [0, 0, 0], 0.06)
  k.box(HD.paint, [4.2, 1.35, 3.0], [-0.8, 1.95, 0], [0, 0, 0], 0.15)
  k.box(HD.grille, [1.2, 0.04, 1.4], [-1.6, 2.64, 0.6], [0, 0, 0], 0.01)
  k.arc(HD.paint, 1.0, 1.6, P * 0.75, P * 1.25, 1.2, [-1.6, 1.3, 0])
  cab(k, 1.4, 1.1, 1.6, [0.9, 2.62, -0.9], { guard: true })
  // mast: a deep box section with a ladder of bracing down each side
  k.box(HD.paint, [0.7, 24, 0.7], [2.0, 13.2, 0], [0, 0, 0], 0.06)
  for (let y = 2; y < 24; y += 1.2) k.box(HD.black, [0.72, 0.05, 0.05], [2.0, 1.2 + y, 0.36], [0, 0, 0], 0)
  k.box(HD.frame, [1.4, 1.2, 1.2], [2.0, 25.4, 0], [0, 0, 0], 0.12)
  k.rod(HD.steel, 0.1, [0.6, 3.2, 0.5], [2.0, 9.0, 0.3])
  k.rod(HD.steel, 0.1, [0.6, 3.2, -0.5], [2.0, 9.0, -0.3])
  beacon(k, [-0.4, 2.7, 1.2])
  k.quad(fleetDecal(id), 1.1, 0.55, [-1.4, 2.63, -0.3], [-P / 2, 0, P / 2])
  return k.build('piling')
}

export function HdPilingRig({ id }: { id: string }) {
  const root = useRef<THREE.Group>(null!)
  const auger = useRef<THREE.Group>(null!)
  const parts = useMemo(() => {
    const a = new Kit()
    a.cyl(HD.chrome, 0.42, 10, [0, 5, 0], [0, 0, 0], 14)
    for (let y = 0.4; y < 9.6; y += 0.55) a.cyl(HD.wornSteel, 0.5, 0.06, [0, y, 0], [0.18, 0, 0], 14)
    a.box(HD.frame, [1.0, 1.0, 1.0], [0, 10.5, 0], [0, 0, 0], 0.1)
    return { body: pileBody(id), auger: a.build('auger') }
  }, [id])
  useMachineDrive(id, root, 5.2, 3.6, (m) => {
    if (m.joints.auger !== undefined) auger.current.rotation.y = m.joints.auger
    auger.current.position.y = 2.4 + Math.max(0, 12 - (m.joints.hammer ?? m.joints.depth ?? 4)) * 0.6
    auger.current.rotation.y += m.speed === 0 && (m.joints.hammer ?? 0) > 0 ? 0.08 : 0
  })
  return (
    <group ref={root}>
      <primitive object={parts.body} />
      <group ref={auger} position={[2.7, 2.4, 0]}>
        <primitive object={parts.auger} />
      </group>
    </group>
  )
}

// ---------- wheel loader, 18 t class. Not in the twin's fleet, shown in the machine gallery.

export function buildLoader(id: string) {
  const k = new Kit()
  k.box(HD.frame, [2.4, 0.5, 1.1], [-1.3, 0.95, 0], [0, 0, 0], 0.06)
  k.taper(HD.paint, 2.4, 1.3, 2.3, 1.05, 2.0, [-3.6, 1.55, 0], [0, 0, 0])
  k.box(HD.grille, [1.0, 0.04, 1.4], [-2.9, 2.18, 0], [0, 0, 0], 0.01)
  k.arc(HD.paint, 0.4, 1.15, P * 0.75, P * 1.25, 0.9, [-3.3, 0.9, 0])
  cab(k, 1.5, 1.6, 1.75, [-0.6, 1.95, 0], { guard: false })
  beacon(k, [-0.9, 3.8, 0.6])
  for (const x of [1.0, -2.4]) for (const z of [1.15, -1.15]) tyre(k, 0.85, 0.66, [x, 0.85, z])
  for (const x of [1.0, -2.4]) for (const z of [1.15, -1.15]) k.shell(HD.paintSheet, 0.98, 0.7, P * 0.5, P * 1.5, [x, 0.85, z], [0, 0, 0], 12)
  k.box(HD.frame, [1.4, 0.5, 1.0], [0.7, 1.0, 0], [0, 0, 0], 0.06)
  for (const z of [0.55, -0.55]) k.taper(HD.paintArm, 2.6, 0.42, 0.22, 0.3, 0.2, [0.6, 1.6, z], [0, 0, -0.32])
  k.rod(HD.chrome, 0.07, [0.8, 1.2, 0], [2.4, 1.0, 0])
  k.shell(HD.sheet, 0.75, 2.9, P * 1.2, P * 2.25, [3.25, 0.62, 0], [0, 0, 0], 14)
  for (const z of [1.45, -1.45]) k.box(HD.wornSteel, [1.2, 1.0, 0.05], [3.1, 0.6, z], [0, 0, 0], 0.02)
  k.box(HD.wornSteel, [0.12, 0.1, 2.9], [3.75, 0.08, 0], [0, 0, 0], 0.01)
  k.quad(fleetDecal(id), 0.9, 0.45, [-2.9, 2.2, 0.62], [-P / 2, 0, P / 2])
  return k.build('loader')
}

export function HdLoader({ id }: { id: string }) {
  const root = useRef<THREE.Group>(null!)
  const g = useMemo(() => buildLoader(id), [id])
  useMachineDrive(id, root, 8, 2.9, () => {})
  return (
    <group ref={root}>
      <primitive object={g} />
    </group>
  )
}

import * as THREE from 'three'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { Environment } from '@react-three/drei'
import { EffectComposer, ChromaticAberration, Noise, Vignette, FXAA } from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'
import { Machines } from '../scene/Machines'
import { LensEffect, lens, distortNdc } from '../scene/LensEffect'
import { camInfo } from '../scene/CameraRig'
import { interpAlpha, machineAt } from '../live/hot'
import { playback } from '../live/client'
import { CAPTURE } from '../live/config'
import { useUi } from '../live/store'
import { isKind } from '../scene/machines/common'
import type { Machine } from '../proto/types'

export interface RealMeta {
  site: string
  title: string
  attribution: string
  capture_utc: [string, string]
  gsd_m: number
  detail: { file: string; rect: [number, number, number, number] }
  surround: { file: string; rect: [number, number, number, number] }
  sun: { azimuth_deg: number; elevation_deg: number; at_utc: string }
  // measured from the photo: shadowed over sunlit ground, linear, per channel
  shadow_ratio?: [number, number, number]
}

// Where the twin sits on the photo: the twin's EX1 stands on the photo anchor, the photo turned by
// THETA and shifted by OFFSET (metres, east and north) so the haul traffic runs on bare ground.
export const ALIGN = { theta: -170, offset: [-10.3, -0.45] as [number, number], simAnchor: [-6, -14] as [number, number] }
export const SHOWN = /^(EX\d|HT\d)$/
const SHADOW: [number, number, number] = [0.08, 0.15, 0.29]

const rad = THREE.MathUtils.degToRad

// photo frame (east, north) to scene (x, z)
export function photoToScene(e: number, n: number, out = new THREE.Vector3()) {
  const t = rad(ALIGN.theta)
  const de = e - ALIGN.offset[0], dn = n - ALIGN.offset[1]
  const sx = Math.cos(t) * de + Math.sin(t) * dn + ALIGN.simAnchor[0]
  const sy = -Math.sin(t) * de + Math.cos(t) * dn + ALIGN.simAnchor[1]
  return out.set(sx, 0, -sy)
}

function Photo({ meta, which, y }: { meta: RealMeta; which: 'detail' | 'surround'; y: number }) {
  const m = meta[which]
  const tex = useLoader(THREE.TextureLoader, `/real/${meta.site}/${m.file}`)
  const gl = useThree((s) => s.gl)
  useMemo(() => {
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = gl.capabilities.getMaxAnisotropy()
    tex.generateMipmaps = true
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.needsUpdate = true
  }, [tex, gl])
  const [w, s, e, n] = m.rect
  // lit ground shows the photo's own pixels, shadowed ground falls to the photo's shadow level
  const mat = useMemo(() => new THREE.MeshLambertMaterial({ map: tex }), [tex])
  return (
    <group rotation={[0, -rad(ALIGN.theta), 0]} position={photoToScene(0, 0).setY(0)}>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[(w + e) / 2, y, -(s + n) / 2]}
        receiveShadow={which === 'detail'}
        material={mat}
      >
        <planeGeometry args={[e - w, n - s]} />
      </mesh>
    </group>
  )
}

function Sun({ meta }: { meta: RealMeta }) {
  const sun = useRef<THREE.DirectionalLight>(null!)
  const scene = useThree((s) => s.scene)
  const ratio = meta.shadow_ratio ?? SHADOW
  const el = rad(meta.sun.elevation_deg)
  const az = rad(meta.sun.azimuth_deg)
  // toward the sun in the photo frame, then into the scene with the photo's turn
  const dir = useMemo(() => {
    const e = Math.sin(az) * Math.cos(el), n = Math.cos(az) * Math.cos(el)
    const t = rad(ALIGN.theta)
    const sx = Math.cos(t) * e + Math.sin(t) * n
    const sy = -Math.sin(t) * e + Math.cos(t) * n
    return new THREE.Vector3(sx, Math.sin(el), -sy).normalize()
  }, [az, el])
  // flat ground sees the sun at sin(elevation), so ambient plus sun adds back to exactly 1 there
  const sunColor = useMemo(() => new THREE.Color(...ratio.map((r) => (1 - r) / Math.sin(el)) as [number, number, number]), [ratio, el])
  const skyColor = useMemo(() => new THREE.Color(...ratio), [ratio])
  const target = useMemo(() => new THREE.Object3D(), [])
  useEffect(() => {
    scene.add(target)
    sun.current.target = target
    return () => void scene.remove(target)
  }, [scene, target])
  useFrame(({ camera }) => {
    // the shadow box follows the camera, so 4k texels cover only what is on screen
    const c = camera.position
    target.position.set(c.x, 0, c.z)
    sun.current.position.copy(target.position).addScaledVector(dir, 200)
    const half = Math.max(20, camInfo.alt * 0.75)
    const cam = sun.current.shadow.camera
    if (cam.right !== half) {
      cam.left = -half
      cam.right = half
      cam.top = half
      cam.bottom = -half
      cam.updateProjectionMatrix()
    }
  })
  return (
    <>
      <ambientLight color={skyColor} intensity={Math.PI} />
      <directionalLight
        ref={sun}
        color={sunColor}
        intensity={Math.PI}
        castShadow
        shadow-mapSize={[4096, 4096]}
        shadow-radius={4}
        shadow-blurSamples={12}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
        shadow-camera-near={50}
        shadow-camera-far={400}
      />
    </>
  )
}

// Soft occlusion right under each machine, the part a shadow map is too coarse for.
function Contact() {
  const ref = useRef<THREE.InstancedMesh>(null!)
  const tex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const g = c.getContext('2d')!
    const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64)
    grd.addColorStop(0, 'rgba(0,0,0,0.85)')
    grd.addColorStop(0.5, 'rgba(0,0,0,0.45)')
    grd.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grd
    g.fillRect(0, 0, 128, 128)
    return new THREE.CanvasTexture(c)
  }, [])
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ map: tex, color: '#0c0a08', transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }), [tex])
  const geo = useMemo(() => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), [])
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), ms: { joints: {} } as Machine }), [])
  const ids = useRef<{ id: string; kind: string }[]>([])
  useFrame(() => {
    const k = interpAlpha()
    const mesh = ref.current
    let i = 0
    for (const { id, kind } of ids.current) {
      const m = machineAt(id, tmp.ms, k)
      if (!m || hiddenNow.has(id)) continue
      const truck = isKind(kind) === 'truck'
      tmp.q.setFromAxisAngle(tmp.up, m.heading)
      tmp.p.set(m.x, 0.02, -m.y)
      tmp.s.set(truck ? 12 : 7, 1, truck ? 4.4 : 5.2)
      mesh.setMatrixAt(i++, tmp.m.compose(tmp.p, tmp.q, tmp.s))
    }
    mesh.count = i
    mesh.instanceMatrix.needsUpdate = true
  })
  useEffect(() => {
    const id = setInterval(() => {
      const st = useUi.getState().state?.machines ?? []
      ids.current = st.filter((m) => SHOWN.test(m.id)).map((m) => ({ id: m.id, kind: m.kind }))
    }, 200)
    return () => clearInterval(id)
  }, [])
  return <instancedMesh ref={ref} args={[geo, mat, 16]} frustumCulled={false} renderOrder={1} />
}

// A near-nadir push-in on EX1, on the playback clock so a stepped render gets every frame.
export const proofCam = { start: 0, dur: 30, from: { alt: 64, pitch: -90, yaw: 0 }, to: { alt: 30, pitch: -82, yaw: 9 } }
const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2)

function PushIn() {
  const t0 = useRef(performance.now())
  const ex = useMemo(() => ({ joints: {} }) as Machine, [])
  const look = useMemo(() => new THREE.Vector3(), [])
  const start = useMemo(() => photoToScene(-28, 8), [])
  useFrame(({ camera }) => {
    const pb = playback()
    const v = pb ? Math.max(0, pb.vNow()) : (performance.now() - t0.current) / 1000
    const k = ease(Math.min(1, Math.max(0, (v - proofCam.start) / proofCam.dur)))
    const m = machineAt('EX1', ex, interpAlpha())
    const goal = m ? new THREE.Vector3(m.x + 3, 0, -m.y - 4) : start
    look.copy(start).lerp(goal, k)
    const { from, to } = proofCam
    const alt = from.alt + (to.alt - from.alt) * k
    const pitch = from.pitch + (to.pitch - from.pitch) * k
    // the photo's north is screen-up at yaw 0
    const yaw = -rad(ALIGN.theta) + rad(from.yaw + (to.yaw - from.yaw) * k)
    const tilt = rad(90 + pitch)
    const back = alt * Math.tan(tilt)
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw)
    camera.position.set(look.x - fx * back, alt, look.z - fz * back)
    camera.up.set(fx, 0, fz)
    camera.lookAt(look)
    const pc = camera as THREE.PerspectiveCamera
    if (pc.fov !== 58) {
      pc.fov = 58
      pc.updateProjectionMatrix()
    }
    camInfo.alt = alt
    camInfo.pitch = pitch
    camInfo.fov = 58
    camInfo.heading = ((from.yaw + (to.yaw - from.yaw) * k) % 360 + 360) % 360
    lens.barrel = 0.03
  })
  return null
}

function Post() {
  const lensFx = useMemo(() => new LensEffect(), [])
  useFrame((state) => lensFx.set(lens.barrel, 0.3, 0.02, state.clock.elapsedTime))
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <primitive object={lensFx} />
      <ChromaticAberration offset={new THREE.Vector2(0.0007, 0.0005)} radialModulation modulationOffset={0.3} />
      <Noise premultiply blendFunction={BlendFunction.OVERLAY} opacity={0.05} />
      <Vignette offset={0.25} darkness={0.55} />
      <FXAA />
    </EffectComposer>
  )
}

const v3 = new THREE.Vector3()
const mm = { joints: {} } as Machine

// Places the HTML tags over the machines, through the same lens as the picture.
function TagProjector() {
  useFrame(({ camera, size }) => {
    const k = interpAlpha()
    document.querySelectorAll<HTMLElement>('[data-tag]').forEach((el) => {
      const m = machineAt(el.dataset.tag!, mm, k)
      if (!m || hiddenNow.has(m.id)) return void (el.style.visibility = 'hidden')
      v3.set(m.x, /excav/i.test(m.kind) ? 6 : 5, -m.y).project(camera)
      distortNdc(v3)
      const vis = v3.z < 1 && Math.abs(v3.x) < 1.05 && Math.abs(v3.y) < 1.05
      el.style.visibility = vis ? 'visible' : 'hidden'
      el.style.transform = `translate(${((v3.x + 1) / 2) * size.width}px, ${((1 - v3.y) / 2) * size.height}px)`
    })
  })
  return null
}

// The twin queues trucks closer than the 3D model is long, so a queued truck that would sit
// inside another machine is left out of the picture rather than drawn through it.
export const hiddenNow = new Set<string>()
const FOOT: Record<string, [number, number]> = { excavator: [5.2, 3.4], truck: [10.6, 3.6] }
const corners = (m: Machine) => {
  const [l, w] = FOOT[isKind(m.kind)] ?? [5, 3]
  const c = Math.cos(m.heading), s = Math.sin(m.heading)
  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) => [m.x + (c * a * l) / 2 - (s * b * w) / 2, m.y + (s * a * l) / 2 + (c * b * w) / 2])
}
function overlap(a: number[][], b: number[][]) {
  for (const poly of [a, b]) {
    for (let i = 0; i < 4; i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % 4]
      const nx = y2 - y1, ny = x1 - x2
      const pa = a.map(([x, y]) => x * nx + y * ny), pb = b.map(([x, y]) => x * nx + y * ny)
      if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false
    }
  }
  return true
}
const busy = (m: Machine) => isKind(m.kind) === 'excavator' || /loading|spot|haul|tip|return|to EX/i.test(m.task) && m.speed > 0.2 || /loading/i.test(m.task)

function Declutter() {
  const scene = useThree((s) => s.scene)
  const pool = useMemo(() => Array.from({ length: 16 }, () => ({ joints: {} }) as Machine), [])
  useFrame(() => {
    const ids = (useUi.getState().state?.machines ?? []).filter((m) => SHOWN.test(m.id)).map((m) => m.id)
    const k = interpAlpha()
    const ms = ids.map((id, i) => machineAt(id, pool[i], k)).filter((m): m is Machine => !!m)
    ms.sort((a, b) => Number(busy(b)) - Number(busy(a)))
    const kept: { m: Machine; c: number[][] }[] = []
    hiddenNow.clear()
    for (const m of ms) {
      const c = corners(m)
      if (kept.some((o) => overlap(o.c, c))) hiddenNow.add(m.id)
      else kept.push({ m, c })
    }
    for (const id of ids) {
      const g = scene.getObjectByName('m:' + id)
      if (g) g.visible = !hiddenNow.has(id)
    }
  })
  return null
}

export function ProofScene({ meta }: { meta: RealMeta }) {
  return (
    <Canvas
      flat
      shadows={{ type: THREE.PCFShadowMap }}
      dpr={1}
      resize={{ offsetSize: true }}
      gl={{ antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: CAPTURE }}
      camera={{ fov: 58, near: 0.5, far: 3000, position: [0, 64, 0] }}
    >
      <color attach="background" args={['#3a4234']} />
      <Suspense fallback={null}>
        <Environment files="/assets/hdri/kloofendal_48d_partly_cloudy_puresky_1k.hdr" environmentIntensity={0.35} />
        <Sun meta={meta} />
        <Photo meta={meta} which="surround" y={-0.03} />
        <Photo meta={meta} which="detail" y={0} />
        <Machines only={(id) => SHOWN.test(id)} />
        <Contact />
        <Declutter />
        <Post />
      </Suspense>
      <PushIn />
      <TagProjector />
    </Canvas>
  )
}

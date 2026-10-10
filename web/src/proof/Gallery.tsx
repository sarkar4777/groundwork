import * as THREE from 'three'
import { Suspense, useEffect, useMemo } from 'react'
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { Environment } from '@react-three/drei'
import { hot } from '../live/hot'
import { useUi } from '../live/store'
import { real, syncReal } from '../real/realSite'
import { RealGround, RealLights, RealPost } from '../real/RealScene'
import { HdDozer, HdExcavator, HdLoader, HdPilingRig, HdRoller, HdTelehandler, HdTruck } from '../scene/hd/HdMachines'
import { MobileCrane, TowerCrane } from '../scene/machines/Cranes'
import { ContactShadows } from '../scene/ContactShadows'
import { useRealLook } from '../scene/hd/realLook'
import type { Machine, StateFrame } from '../proto/types'

// Close stills of each machine on the real ground under the capture's sun, for the test pass.
// A static pose per machine, so this page is a model check, not a site view.

const KINDS: Record<string, { kind: string; C: (p: { id: string }) => JSX.Element; joints: Record<string, number>; load?: number; size: number }> = {
  excavator: { kind: 'excavator', C: HdExcavator, joints: { swing: 0.5, boom: 0.42, stick: 0.75, bucket: 0.5 }, load: 1.5, size: 10 },
  truck: { kind: 'haul_truck', C: HdTruck, joints: { body: 0 }, load: 18, size: 12 },
  dozer: { kind: 'dozer', C: HdDozer, joints: { blade: 0.1 }, size: 7 },
  roller: { kind: 'roller', C: HdRoller, joints: {}, size: 7 },
  loader: { kind: 'wheel_loader', C: HdLoader, joints: {}, size: 9 },
  telehandler: { kind: 'telehandler', C: HdTelehandler, joints: { boom: 0.35, extension: 0.4 }, size: 10 },
  piling: { kind: 'piling_rig', C: HdPilingRig, joints: { hammer: 6 }, size: 12 },
  mobile_crane: { kind: 'mobile_crane', C: MobileCrane, joints: {}, size: 22 },
  tower_crane: { kind: 'tower_crane', C: TowerCrane, joints: {}, size: 60 },
}

const SPOT = { x: -14, y: -16 }
const SCALE_SPOT = { x: -26, y: 3.5, heading: -0.3 }

function useStaticState(which: string, scale: boolean) {
  useMemo(() => {
    const spec = KINDS[which]
    const at = scale ? SCALE_SPOT : { ...SPOT, heading: 0.6 }
    const m = {
      id: 'GX1', kind: spec.kind, x: at.x, y: at.y, z: 0, heading: at.heading, joints: spec.joints, speed: 0, mode: 'auto',
      load_t: spec.load ?? 0, fuel_pct: 80, health: 'ok', task: 'gallery',
    } as unknown as Machine
    const crane = /crane/.test(spec.kind)
      ? [{ id: 'GX1', kind: spec.kind, x: at.x, y: at.y, slew: 0.6, luff: 0.9, hook: [at.x + 12, at.y + 6, 10], load_t: 0 }]
      : []
    const f = { type: 'state', t: 0, machines: [m], workers: [], cranes: crane } as unknown as StateFrame
    hot.prev = f
    hot.curr = f
    hot.prevAt = hot.currAt = performance.now()
    hot.site = {
      size: 200, zones: [], haulRoads: [], spoil: null, pit: null, building: null, gate: null, designDepth: -8, piles: [], swingRadius: 9.8,
      craneBases: crane.length ? [{ id: 'GX1', kind: /mobile/.test(spec.kind) ? 'mobile' : 'tower', x: at.x, y: at.y, radius: 40 }] : [],
      imagery: { site: 'nh108', kind: 'orthophoto' },
    }
    hot.siteVersion++
    useUi.setState({ state: f })
  }, [which, scale])
}

function ScalePatch() {
  const meta = real.meta as unknown as { site: string; scale_patch?: { file: string; rect: [number, number, number, number] } }
  const tex = useLoader(THREE.TextureLoader, `/real/${meta.site}/${meta.scale_patch!.file}`)
  tex.colorSpace = THREE.SRGBColorSpace
  const [w, s, e, n] = meta.scale_patch!.rect
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(w + e) / 2, 0.004, -(s + n) / 2]} receiveShadow>
      <planeGeometry args={[e - w, n - s]} />
      <meshLambertMaterial map={tex} />
    </mesh>
  )
}

const VIEWS: Record<string, (c: { x: number; y: number }, size: number) => { pos: [number, number, number]; look: [number, number, number]; fov: number }> = {
  top: (c, s) => ({ pos: [c.x + 0.01, s * 1.9, -c.y + 0.6], look: [c.x, 0, -c.y], fov: 34 }),
  oblique: (c, s) => ({ pos: [c.x + s * 1.0, s * 1.15, -c.y + s * 1.0], look: [c.x, 1.2, -c.y], fov: 36 }),
  side: (c, s) => ({ pos: [c.x - s * 1.35, s * 0.45, -c.y + s * 0.75], look: [c.x, 1.4, -c.y], fov: 36 }),
}

function Cam({ which, view, scale }: { which: string; view: string; scale: boolean }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  useFrame(() => {
    if (scale) {
      // straight down at a known scale over the untouched patch: 30.5 m across the frame
      const meta = real.meta as unknown as { scale_patch?: { rect: [number, number, number, number] } }
      const [w, s, e, n] = meta.scale_patch!.rect
      camera.fov = 20
      const half = (e - w) / 2 / (camera.aspect || 16 / 9)
      camera.position.set((w + e) / 2, Math.max(half, (n - s) / 2) / Math.tan(THREE.MathUtils.degToRad(10)), -(s + n) / 2 + 0.001)
      camera.lookAt((w + e) / 2, 0, -(s + n) / 2)
    } else {
      const v = VIEWS[view](SPOT, KINDS[which].size)
      camera.fov = v.fov
      camera.position.set(...v.pos)
      camera.lookAt(...v.look)
    }
    camera.updateProjectionMatrix()
  })
  return null
}

export function Gallery() {
  const q = new URLSearchParams(location.search)
  const which = q.get('machine') ?? 'excavator'
  const view = q.get('view') ?? 'oblique'
  const scale = view === 'scale'
  const ready = useUi((s) => !!s.realGround)
  useStaticState(which, scale)
  useRealLook(true)
  useEffect(() => {
    syncReal()
  }, [])
  const composer = useMemo(() => ({ current: null }), [])
  const spec = KINDS[which]
  if (!ready || !real.meta) return <div className="proof-empty">Loading the real site</div>
  return (
    <div className="proof">
      <Canvas flat shadows={{ type: THREE.PCFShadowMap }} dpr={1} gl={{ antialias: false, preserveDrawingBuffer: true }} camera={{ fov: 36, near: 0.3, far: 3000, position: [0, 30, 30] }}>
        <Suspense fallback={null}>
          <Environment files="/assets/hdri/kloofendal_48d_partly_cloudy_puresky_1k.hdr" />
          <RealLights />
          <RealGround />
          {scale && <ScalePatch />}
          <group>
            <spec.C id="GX1" />
          </group>
          <ContactShadows />
          <RealPost composerRef={composer} />
        </Suspense>
        <Cam which={which} view={view} scale={scale} />
      </Canvas>
      <div className="proof-credit">
        <div>
          <b className="sim">SIMULATED</b> {which.replace('_', ' ')}, static pose, {scale ? 'top-down at the photo scale beside a real excavator in the untouched photo' : `${view} view`}.
        </div>
        <div>
          <b>REAL</b> ground: {real.meta.attribution}.
        </div>
      </div>
    </div>
  )
}

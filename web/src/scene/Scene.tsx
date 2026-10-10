import * as THREE from 'three'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Environment } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette, Noise, ChromaticAberration, ToneMapping, FXAA, HueSaturation, BrightnessContrast } from '@react-three/postprocessing'
import { BlendFunction, ToneMappingMode, type BloomEffect, type ChromaticAberrationEffect, type NoiseEffect, type VignetteEffect, type HueSaturationEffect, type BrightnessContrastEffect } from 'postprocessing'
import { Ground } from './ground/Ground'
import { Machines } from './Machines'
import { Workers } from './Workers'
import { Overlays } from './Overlays'
import { Nervous } from './Nervous'
import { CameraRig } from './CameraRig'
import { LabelProjector } from './Labels'
import { nervous, storyCut } from './nervousState'
import { applyNervous, dimWithNervous } from './materials'
import { useUi } from '../live/store'
import { CAPTURE, RENDER } from '../live/config'
import { HIGH } from '../live/quality'
import { ContactShadows } from './ContactShadows'
import { LensEffect, lens } from './LensEffect'
import { RealGround, RealLights, RealPost } from '../real/RealScene'

const DEBUG = new URLSearchParams(location.search).get('debug') ?? ''
// Late afternoon from the west-south-west. The survey feed holds the sun at 17 degrees, the hero drops it to 11.
const SUN_AZ = THREE.MathUtils.degToRad(208)
const sunDir = (elevDeg: number, out: THREE.Vector3) => {
  const e = THREE.MathUtils.degToRad(elevDeg)
  return out.set(Math.cos(SUN_AZ) * Math.cos(e), Math.sin(e), -Math.sin(SUN_AZ) * Math.cos(e)).multiplyScalar(400)
}
const SUN = sunDir(17, new THREE.Vector3())
const HAZE = new THREE.Color('#b8c0c4')
const HAZE_GOLD = new THREE.Color('#d9bfa0')
const SUN_DAY = new THREE.Color('#ffe2c2')
const SUN_GOLD = new THREE.Color('#ffd7ab')
const SKY_DAY = new THREE.Color('#cfe0f2')
const SKY_GOLD = new THREE.Color('#8fb0e0')
const NAVY = new THREE.Color('#041230')

function Lights() {
  const sun = useRef<THREE.DirectionalLight>(null!)
  const hemi = useRef<THREE.HemisphereLight>(null!)
  const heroK = useRef(0)
  const scene = useThree((s) => s.scene)
  const env = useRef<THREE.Texture | null>(null)
  const fog = useMemo(() => new THREE.Fog(HAZE.clone(), 520, 2200), [])
  useEffect(() => {
    scene.fog = fog
    sun.current.target.position.set(0, 0, 0)
    scene.add(sun.current.target)
  }, [scene, fog])
  useFrame(() => {
    const k = nervous.k
    applyNervous(k)
    // the hero shot gets the golden hour, the survey feed a neutral late-afternoon sun
    const hero = useUi.getState().heroFx ? 1 : 0
    heroK.current += (hero - heroK.current) * 0.05
    if (performance.now() - storyCut.at < 100) heroK.current = hero
    const g = heroK.current
    const elev = 17 - g * 6
    sunDir(elev, sun.current.position)
    sun.current.color.copy(SUN_DAY).lerp(SUN_GOLD, g)
    // a low sun lights flat ground weakly, so it gets brighter as it drops, with cool sky fill in the shadows
    sun.current.intensity = Math.min(7, 1.2 / Math.sin(THREE.MathUtils.degToRad(elev))) * (1 - k * 0.9)
    hemi.current.color.copy(SKY_DAY).lerp(SKY_GOLD, g)
    hemi.current.intensity = (0.55 + g * 0.1) * (1 - k * 0.8)
    scene.environmentIntensity = (0.5 - g * 0.15) * (1 - k * 0.85)
    if (!env.current && scene.background instanceof THREE.Texture) env.current = scene.background
    if (k > 0.5) {
      if (!(scene.background instanceof THREE.Color)) scene.background = NAVY.clone()
    } else if (env.current && scene.background !== env.current) scene.background = env.current
    fog.color.copy(HAZE).lerp(HAZE_GOLD, g).lerp(NAVY, k)
    fog.near = 520 - g * 260 - k * 300
    fog.far = 2200 - g * 900 - k * 1500
  })
  return (
    <>
      <hemisphereLight ref={hemi} args={['#cfe0f2', '#6e6458', 0.55]} />
      <directionalLight
        ref={sun}
        position={SUN}
        intensity={3.4}
        color="#ffe4c8"
        castShadow
        shadow-mapSize={HIGH ? [4096, 4096] : [2048, 2048]}
        shadow-radius={HIGH ? 3 : 1}
        shadow-bias={-0.0006}
        shadow-normalBias={0.12}
        shadow-camera-left={-175}
        shadow-camera-right={175}
        shadow-camera-top={175}
        shadow-camera-bottom={-175}
        shadow-camera-near={50}
        shadow-camera-far={900}
      />
    </>
  )
}

const horizonMat = new THREE.MeshStandardMaterial({ color: '#6f7558', roughness: 1 })
dimWithNervous(horizonMat)

function Horizon() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.5, 0]} receiveShadow={false}>
      <ringGeometry args={[590, 6000, 64, 1]} />
      <primitive object={horizonMat} attach="material" />
    </mesh>
  )
}

function Post() {
  const bloom = useRef<BloomEffect>(null!)
  const ca = useRef<ChromaticAberrationEffect>(null!)
  const noise = useRef<NoiseEffect>(null!)
  const vig = useRef<VignetteEffect>(null!)
  const hue = useRef<HueSaturationEffect>(null!)
  const bc = useRef<BrightnessContrastEffect>(null!)
  const lensFx = useMemo(() => new LensEffect(), [])
  useFrame((state) => {
    const k = nervous.k
    const ui = useUi.getState()
    const cam = ui.cam
    const feed = cam === 'drone' && !ui.heroFx ? 1 : 0.4
    // survey footage reads slightly desaturated with neutral whites, the hero shot keeps its warmth
    if (hue.current) hue.current.saturation = ui.heroFx ? -0.12 : -0.16 + k * 0.16
    if (bc.current) bc.current.contrast = ui.heroFx ? 0.18 : 0.12
    if (bloom.current) {
      // in daylight only beacons and glints bloom, the ground never does
      bloom.current.intensity = 0.25 + k * 1.7
      bloom.current.luminanceMaterial.threshold = 1.6 - k * 1.23
    }
    if (ca.current) ca.current.offset.set(0.0009 * feed, 0.0006 * feed)
    if (noise.current) noise.current.blendMode.opacity.value = 0.03 + feed * 0.03
    const droneCam = cam === 'drone' && k < 0.5
    lens.barrel = droneCam ? 0.035 : 0
    lensFx.set(lens.barrel, droneCam ? 0.3 : k > 0.5 ? 0 : 0.2, droneCam ? 0.022 : 0.012, state.clock.elapsedTime)
    if (vig.current) vig.current.darkness = 0.45 + feed * 0.25 + k * 0.1
  })
  return (
    <EffectComposer ref={(c) => (composerRef.current = c as unknown as Resizable | null)} multisampling={0} enableNormalPass={false}>
      <primitive object={lensFx} />
      <Bloom ref={bloom as never} mipmapBlur levels={5} resolutionScale={0.5} intensity={0.4} luminanceThreshold={0.92} luminanceSmoothing={0.2} radius={0.72} />
      <ChromaticAberration ref={ca as never} offset={new THREE.Vector2(0.0009, 0.0006)} radialModulation modulationOffset={0.3} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <HueSaturation ref={hue as never} saturation={-0.16} />
      <BrightnessContrast ref={bc as never} contrast={0.12} brightness={-0.02} />
      <Noise ref={noise as never} premultiply blendFunction={BlendFunction.OVERLAY} opacity={0.1} />
      <Vignette ref={vig as never} offset={0.22} darkness={0.7} />
      <FXAA />
    </EffectComposer>
  )
}

// fps for the HUD, and an adaptive render scale that holds 60 fps on integrated graphics.
// Fill rate is the limit, so the 3D view drops resolution before anything else.
export const renderScale = { value: 1 }
interface Resizable { setSize: (w: number, h: number) => void }
const composerRef: { current: Resizable | null } = { current: null }

function FrameMeter() {
  const setDpr = useThree((s) => s.setDpr)
  const size = useThree((s) => s.size)
  const base = Math.min(window.devicePixelRatio, 1.75)
  const acc = useRef({ n: 0, t: performance.now(), low: 0, high: 0, scale: 1, since: performance.now() })
  useFrame(() => {
    const a = acc.current
    a.n++
    const now = performance.now()
    if (now - a.t < 1000) return
    const fps = (a.n * 1000) / (now - a.t)
    a.n = 0
    a.t = now
    useUi.setState({ fps: Math.round(fps) })
    ;(window as unknown as { __gwFps: number[] }).__gwFps ??= []
    ;(window as unknown as { __gwFps: number[] }).__gwFps.push(fps)
    if (CAPTURE || HIGH || document.hidden || now - a.since < 8000) return
    a.low = fps < 54 ? a.low + 1 : 0
    a.high = fps > 58.5 ? a.high + 1 : 0
    let next = a.scale
    if (a.low >= 2 && a.scale > 0.6) next = Math.max(0.6, a.scale * Math.sqrt(Math.max(0.5, fps / 60)) - 0.02)
    else if (a.high >= 6 && a.scale < 1) next = Math.min(1, a.scale + 0.08)
    if (next !== a.scale) {
      a.scale = next
      a.low = 0
      a.high = 0
      renderScale.value = next
      ;(window as unknown as { __gwScale: number }).__gwScale = next
      setDpr(base * next)
      requestAnimationFrame(() => composerRef.current?.setSize(size.width, size.height))
    }
  })
  return null
}

// The sun never moves, so the shadow map only needs to follow the machines at half the frame rate.
function ShadowThrottle() {
  const gl = useThree((s) => s.gl)
  const n = useRef(0)
  useEffect(() => {
    gl.shadowMap.autoUpdate = false
    gl.shadowMap.needsUpdate = true
    return () => {
      gl.shadowMap.autoUpdate = true
    }
  }, [gl])
  useFrame(() => {
    if (RENDER || ++n.current % 2 === 0) gl.shadowMap.needsUpdate = true
  })
  return null
}

// Compile every program in parallel up front, so the first frames do not stall on shader builds.
function Prewarm() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    const id = setTimeout(() => {
      const r = gl as unknown as { compileAsync?: (s: THREE.Object3D, c: THREE.Camera) => Promise<void> }
      r.compileAsync?.(scene, camera).catch(() => {})
    }, 200)
    return () => clearTimeout(id)
  }, [gl, scene, camera])
  return null
}

function hoverGround(e: ThreeEvent<PointerEvent>) {
  if (e.object.name !== 'ground') return
  const p = e.point
  useUi.setState({ hover: { x: p.x, y: -p.z, z: p.y } })
}

export function Scene() {
  const realG = useUi((s) => !!s.realGround)
  return (
    <Canvas
      shadows={DEBUG.includes('noshadow') ? false : { type: HIGH || DEBUG.includes('soft') ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap }}
      dpr={[1, 1.75]}
      resize={{ offsetSize: true }}
      gl={{ antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: CAPTURE }}
      camera={{ fov: 58, near: 0.5, far: 7000, position: [0, 120, 1] }}
      onPointerMissed={() => useUi.setState({ selected: null })}
      onPointerLeave={() => useUi.setState({ hover: null })}
    >
      <Suspense fallback={null}>
        <Environment files="/assets/hdri/kloofendal_48d_partly_cloudy_puresky_1k.hdr" background environmentIntensity={0.75} />
        {realG ? <RealLights /> : <Lights />}
        {!realG && <Horizon />}
        <group onPointerMove={hoverGround}>{realG ? <RealGround /> : <Ground />}</group>
        {!DEBUG.includes('nomachines') && <Machines />}
        <ContactShadows />
        {!DEBUG.includes('noworkers') && <Workers />}
        <Overlays />
        <Nervous />
        <Prewarm />
        {!DEBUG.includes('nopost') && (realG ? <RealPost composerRef={composerRef} /> : <Post />)}
      </Suspense>
      <CameraRig />
      <LabelProjector />
      <FrameMeter />
      <ShadowThrottle />
    </Canvas>
  )
}

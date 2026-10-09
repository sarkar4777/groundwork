import * as THREE from 'three'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Environment } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette, Noise, ChromaticAberration, ToneMapping, FXAA } from '@react-three/postprocessing'
import { BlendFunction, ToneMappingMode, type BloomEffect, type ChromaticAberrationEffect, type NoiseEffect, type VignetteEffect } from 'postprocessing'
import { Ground } from './ground/Ground'
import { Machines } from './Machines'
import { Workers } from './Workers'
import { Overlays } from './Overlays'
import { Nervous } from './Nervous'
import { CameraRig } from './CameraRig'
import { LabelProjector } from './Labels'
import { nervous } from './nervousState'
import { applyNervous, dimWithNervous } from './materials'
import { useUi } from '../live/store'
import { CAPTURE } from '../live/config'

const DEBUG = new URLSearchParams(location.search).get('debug') ?? ''
const SUN = new THREE.Vector3(-165, 78, 92)
const HAZE = new THREE.Color('#c9b49c')
const NAVY = new THREE.Color('#041230')

function Lights() {
  const sun = useRef<THREE.DirectionalLight>(null!)
  const hemi = useRef<THREE.HemisphereLight>(null!)
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
    sun.current.intensity = 3.4 * (1 - k * 0.9)
    hemi.current.intensity = 0.55 * (1 - k * 0.8)
    scene.environmentIntensity = 0.75 * (1 - k * 0.85)
    if (!env.current && scene.background instanceof THREE.Texture) env.current = scene.background
    if (k > 0.5) {
      if (!(scene.background instanceof THREE.Color)) scene.background = NAVY.clone()
    } else if (env.current && scene.background !== env.current) scene.background = env.current
    fog.color.copy(HAZE).lerp(NAVY, k)
    fog.near = 520 - k * 300
    fog.far = 2200 - k * 1500
  })
  return (
    <>
      <hemisphereLight ref={hemi} args={['#bcd6ff', '#6b5137', 0.55]} />
      <directionalLight
        ref={sun}
        position={SUN}
        intensity={3.4}
        color="#ffd3a6"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
        shadow-camera-left={-125}
        shadow-camera-right={125}
        shadow-camera-top={125}
        shadow-camera-bottom={-125}
        shadow-camera-near={10}
        shadow-camera-far={520}
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
  useFrame(() => {
    const k = nervous.k
    const cam = useUi.getState().cam
    const feed = cam === 'drone' ? 1 : 0.4
    if (bloom.current) {
      bloom.current.intensity = 0.35 + k * 1.6
      bloom.current.luminanceMaterial.threshold = 0.92 - k * 0.55
    }
    if (ca.current) ca.current.offset.set(0.0009 * feed, 0.0006 * feed)
    if (noise.current) noise.current.blendMode.opacity.value = 0.05 + feed * 0.06
    if (vig.current) vig.current.darkness = 0.45 + feed * 0.25 + k * 0.1
  })
  return (
    <EffectComposer ref={(c) => (composerRef.current = c as unknown as Resizable | null)} multisampling={0} enableNormalPass={false}>
      <Bloom ref={bloom as never} mipmapBlur levels={5} resolutionScale={0.5} intensity={0.4} luminanceThreshold={0.92} luminanceSmoothing={0.2} radius={0.72} />
      <ChromaticAberration ref={ca as never} offset={new THREE.Vector2(0.0009, 0.0006)} radialModulation modulationOffset={0.3} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
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
    if (CAPTURE || document.hidden || now - a.since < 8000) return
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
    if (++n.current % 2 === 0) gl.shadowMap.needsUpdate = true
  })
  return null
}

function hoverGround(e: ThreeEvent<PointerEvent>) {
  if (e.object.name !== 'ground') return
  const p = e.point
  useUi.setState({ hover: { x: p.x, y: -p.z, z: p.y } })
}

export function Scene() {
  return (
    <Canvas
      shadows={DEBUG.includes('noshadow') ? false : { type: DEBUG.includes('soft') ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap }}
      dpr={[1, 1.75]}
      gl={{ antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: CAPTURE }}
      camera={{ fov: 58, near: 0.5, far: 7000, position: [0, 120, 1] }}
      onPointerMissed={() => useUi.setState({ selected: null })}
      onPointerLeave={() => useUi.setState({ hover: null })}
    >
      <Suspense fallback={null}>
        <Environment files="/assets/hdri/belfast_sunset_puresky_1k.hdr" background environmentIntensity={0.75} />
        <Lights />
        <Horizon />
        <group onPointerMove={hoverGround}>
          <Ground />
        </group>
        {!DEBUG.includes('nomachines') && <Machines />}
        {!DEBUG.includes('noworkers') && <Workers />}
        <Overlays />
        <Nervous />
        {!DEBUG.includes('nopost') && <Post />}
      </Suspense>
      <CameraRig />
      <LabelProjector />
      <FrameMeter />
      <ShadowThrottle />
    </Canvas>
  )
}

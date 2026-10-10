import * as THREE from 'three'
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useLoader, useThree } from '@react-three/fiber'
import { Splat } from '@react-three/drei'
import { EffectComposer, Bloom, ChromaticAberration, Noise, Vignette, FXAA, N8AO } from '@react-three/postprocessing'
import { BlendFunction, type BloomEffect, type VignetteEffect } from 'postprocessing'
import { real, realUrl, type RealMeta } from './realSite'
import { useUi } from '../live/store'
import { nervous } from '../scene/nervousState'
import { applyNervous, dimWithNervous } from '../scene/materials'
import { LensEffect, lens } from '../scene/LensEffect'
import { camInfo } from '../scene/CameraRig'
import { HIGH } from '../live/quality'

const rad = THREE.MathUtils.degToRad
const NAVY = new THREE.Color('#041230')
// shadowed over sunlit bare ground when a site has not measured its own
const SHADOW: [number, number, number] = [0.08, 0.15, 0.29]

// Points from the site toward the sun, in scene axes (x east, y up, z south).
export function sunDirection(meta: RealMeta, out = new THREE.Vector3()) {
  const el = rad(meta.sun?.elevation_deg ?? 35)
  const az = rad(meta.sun?.azimuth_deg ?? 200)
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize()
}

function usePhoto(url: string) {
  const tex = useLoader(THREE.TextureLoader, url)
  const gl = useThree((s) => s.gl)
  useMemo(() => {
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = gl.capabilities.getMaxAnisotropy()
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.generateMipmaps = true
    tex.needsUpdate = true
  }, [tex, gl])
  return tex
}

// Lambert under a sky light equal to the measured shadow ratio and a sun scaled by 1/sin(elevation):
// flat sunlit ground renders at exactly the photo's own pixels, shadowed ground at the photo's shadow level.
function photoMaterial(tex: THREE.Texture) {
  const m = new THREE.MeshLambertMaterial({ map: tex })
  dimWithNervous(m as unknown as THREE.MeshStandardMaterial)
  return m
}

function Plane({ url, rect, y, receive }: { url: string; rect: [number, number, number, number]; y: number; receive: boolean }) {
  const tex = usePhoto(url)
  const mat = useMemo(() => photoMaterial(tex), [tex])
  const [w, s, e, n] = rect
  return (
    <mesh name="ground" rotation={[-Math.PI / 2, 0, 0]} position={[(w + e) / 2, y, -(s + n) / 2]} receiveShadow={receive} material={mat}>
      <planeGeometry args={[e - w, n - s]} />
    </mesh>
  )
}

// A reconstruction: the orthophoto draped over the DSM.
function Draped({ meta }: { meta: RealMeta }) {
  const tex = usePhoto(realUrl(meta.site, meta.ortho!.file))
  const mat = useMemo(() => photoMaterial(tex), [tex])
  const geo = useMemo(() => {
    const g = meta.grid!
    const h = real.heights
    const n = 256
    const geo = new THREE.PlaneGeometry(g.extent, g.extent, n - 1, n - 1)
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i)
      const fi = ((x + g.extent / 2) / g.extent) * (g.n - 1)
      const fj = ((-z + g.extent / 2) / g.extent) * (g.n - 1)
      const ii = Math.max(0, Math.min(g.n - 1, Math.round(fi))), jj = Math.max(0, Math.min(g.n - 1, Math.round(fj)))
      pos.setY(i, h ? h[jj * g.n + ii] : 0)
    }
    geo.computeVertexNormals()
    return geo
  }, [meta])
  return <mesh name="ground" geometry={geo} material={mat} receiveShadow />
}

function Filler() {
  const mat = useMemo(() => {
    const m = new THREE.MeshLambertMaterial({ color: '#3d4733' })
    dimWithNervous(m as unknown as THREE.MeshStandardMaterial)
    return m
  }, [])
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, 0]} material={mat}>
      <planeGeometry args={[4000, 4000]} />
    </mesh>
  )
}

export function RealGround() {
  const site = useUi((s) => s.realGround?.site)
  const meta = real.meta
  const splatOn = new URLSearchParams(location.search).get('layer') === 'splat'
  if (!site || !meta) return null
  return (
    <group>
      <Filler />
      {meta.surround && <Plane url={realUrl(meta.site, meta.surround.file)} rect={meta.surround.rect} y={-0.03} receive={false} />}
      {meta.detail && <Plane url={realUrl(meta.site, meta.detail.file)} rect={meta.detail.rect} y={0} receive />}
      {meta.ortho && meta.grid && <Draped meta={meta} />}
      {splatOn && meta.splat && <Splat src={realUrl(meta.site, meta.splat.file)} alphaTest={0.05} />}
    </group>
  )
}

export function RealLights() {
  const sun = useRef<THREE.DirectionalLight>(null!)
  const amb = useRef<THREE.AmbientLight>(null!)
  const scene = useThree((s) => s.scene)
  const env = useRef<THREE.Texture | null>(null)
  const target = useMemo(() => new THREE.Object3D(), [])
  const dir = useMemo(() => new THREE.Vector3(), [])
  const sunCol = useMemo(() => new THREE.Color(), [])
  const skyCol = useMemo(() => new THREE.Color(), [])
  useEffect(() => {
    scene.fog = null
    scene.add(target)
    sun.current.target = target
    return () => void scene.remove(target)
  }, [scene, target])
  useFrame(({ camera }) => {
    const meta = real.meta
    if (!meta) return
    const k = nervous.k
    applyNervous(k)
    const ratio = meta.shadow_ratio ?? SHADOW
    sunDirection(meta, dir)
    const sinEl = Math.max(0.15, dir.y)
    sunCol.setRGB(...(ratio.map((r) => (1 - r) / sinEl) as [number, number, number]))
    skyCol.setRGB(...ratio)
    sun.current.color.copy(sunCol)
    sun.current.intensity = Math.PI * (1 - k * 0.9)
    amb.current.color.copy(skyCol)
    amb.current.intensity = Math.PI * (1 - k * 0.8)
    scene.environmentIntensity = 0.45 * (1 - k * 0.85)
    // the shadow box follows what the camera looks at, so its texels go where they are seen
    const look = new THREE.Vector3()
    camera.getWorldDirection(look)
    const tdist = camera.position.y / Math.max(0.2, -look.y)
    target.position.copy(camera.position).addScaledVector(look, Math.min(400, tdist)).setY(0)
    sun.current.position.copy(target.position).addScaledVector(dir, 250)
    const half = THREE.MathUtils.clamp(camInfo.alt * Math.tan(rad(camInfo.fov) / 2) * 1.9, 25, 140)
    const cam = sun.current.shadow.camera
    if (Math.abs(cam.right - half) > 0.5) {
      cam.left = -half
      cam.right = half
      cam.top = half
      cam.bottom = -half
      cam.updateProjectionMatrix()
    }
    if (!env.current && scene.background instanceof THREE.Texture) env.current = scene.background
    if (k > 0.5) {
      if (!(scene.background instanceof THREE.Color)) scene.background = NAVY.clone()
    } else if (env.current && scene.background !== env.current) scene.background = env.current
  })
  return (
    <>
      <ambientLight ref={amb} intensity={Math.PI} />
      <directionalLight
        ref={sun}
        castShadow
        intensity={Math.PI}
        shadow-mapSize={HIGH ? [4096, 4096] : [2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.05}
        shadow-camera-near={20}
        shadow-camera-far={600}
      />
    </>
  )
}

interface Resizable { setSize: (w: number, h: number) => void }

export function RealPost({ composerRef }: { composerRef: { current: Resizable | null } }) {
  const bloom = useRef<BloomEffect>(null!)
  const vig = useRef<VignetteEffect>(null!)
  const lensFx = useMemo(() => new LensEffect(), [])
  useFrame((state) => {
    const k = nervous.k
    const ui = useUi.getState()
    const droneCam = ui.cam === 'drone' && k < 0.5
    lens.barrel = droneCam ? 0.03 : 0
    lensFx.set(lens.barrel, droneCam ? 0.28 : 0.18, droneCam ? 0.02 : 0.012, state.clock.elapsedTime)
    if (bloom.current) {
      bloom.current.intensity = 0.2 + k * 1.7
      bloom.current.luminanceMaterial.threshold = 1.6 - k * 1.23
    }
    if (vig.current) vig.current.darkness = 0.5 + k * 0.15
  })
  return (
    <EffectComposer ref={(c) => (composerRef.current = c as unknown as Resizable | null)} multisampling={0} enableNormalPass={false}>
      <N8AO aoRadius={1.6} distanceFalloff={0.6} intensity={2.2} quality={HIGH ? 'high' : 'medium'} halfRes />
      <primitive object={lensFx} />
      <Bloom ref={bloom as never} mipmapBlur levels={5} resolutionScale={0.5} intensity={0.2} luminanceThreshold={1.6} luminanceSmoothing={0.2} radius={0.7} />
      <ChromaticAberration offset={new THREE.Vector2(0.0007, 0.0005)} radialModulation modulationOffset={0.3} />
      <Noise premultiply blendFunction={BlendFunction.OVERLAY} opacity={0.05} />
      <Vignette ref={vig as never} offset={0.25} darkness={0.5} />
      <FXAA />
    </EffectComposer>
  )
}

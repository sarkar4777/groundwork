import * as THREE from 'three'
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useLoader, useThree } from '@react-three/fiber'
import { hot } from '../../live/hot'
import type { Terrain } from '../../proto/types'
import { groundState, setTarget, stepMorph } from './heights'
import { CITY, TEX, paintCity, paintSite, type Imgs, type TexKey } from './paint'
import { City } from './City'
import { nervous } from '../nervousState'
import { Dressing } from './Dressing'
import { useUi } from '../../live/store'

const N0 = 256
const EXT = 200

function buildGrid(n: number, ext: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  const pos = new Float32Array(n * n * 3)
  const uv = new Float32Array(n * n * 2)
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const k = j * n + i
      pos[k * 3] = -ext / 2 + (i / (n - 1)) * ext
      pos[k * 3 + 1] = 0
      pos[k * 3 + 2] = -(-ext / 2 + (j / (n - 1)) * ext)
      uv[k * 2] = i / (n - 1)
      uv[k * 2 + 1] = j / (n - 1)
    }
  const idx = new Uint32Array((n - 1) * (n - 1) * 6)
  let p = 0
  for (let j = 0; j < n - 1; j++)
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1
      idx[p++] = a; idx[p++] = b; idx[p++] = c
      idx[p++] = b; idx[p++] = d; idx[p++] = c
    }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  g.setIndex(new THREE.BufferAttribute(idx, 1))
  g.computeVertexNormals()
  g.computeBoundingSphere()
  return g
}

function texFrom(img: HTMLImageElement, srgb = true): THREE.Texture {
  const t = new THREE.Texture(img)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  t.anisotropy = 8
  t.needsUpdate = true
  return t
}

function canvasTex(c: HTMLCanvasElement, aniso = 8): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = aniso
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  return t
}

export const groundUniforms = {
  uNervous: { value: 0 },
  uDetail: { value: 1.15 },
}

const DETAIL = /* glsl */ `
float gwLum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
// photographic micro contrast: the 4k aerial scan at two scales and angles, high-passed around its own mean
float gwDetail(sampler2D t, vec2 p) {
  float m = gwLum(textureLod(t, vec2(0.5), 12.0).rgb);
  float a = gwLum(texture2D(t, p / 7.5).rgb);
  float b = gwLum(texture2D(t, mat2(0.8, -0.6, 0.6, 0.8) * p / 21.0 + 0.31).rgb);
  return 1.0 + (a - m) * 1.25 + (b - m) * 0.85;
}
`

function terrainMaterial(site: THREE.Texture, mud: THREE.Texture, dirt: THREE.Texture, decal: THREE.Texture, det: THREE.Texture) {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.96, metalness: 0 })
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      tSite: { value: site },
      tMud: { value: mud },
      tDirt: { value: dirt },
      tDecal: { value: decal },
      tDet: { value: det },
      uExt: { value: EXT },
      uNervous: groundUniforms.uNervous,
      uDetail: groundUniforms.uDetail,
    })
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec3 vNW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvNW = normalize(mat3(modelMatrix) * objectNormal);')
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWP;
varying vec3 vNW;
uniform sampler2D tSite;
uniform sampler2D tMud;
uniform sampler2D tDirt;
uniform sampler2D tDecal;
uniform sampler2D tDet;
uniform float uExt;
uniform float uNervous;
uniform float uDetail;
${DETAIL}`,
      )
      .replace(
        '#include <map_fragment>',
        `vec2 suv = vec2((vWP.x + uExt * 0.5) / uExt, (-vWP.z + uExt * 0.5) / uExt);
vec3 col = texture2D(tSite, suv).rgb;
float depth = clamp(-vWP.y, 0.0, 30.0);
if (depth > 0.8) {
  vec3 mud = texture2D(tMud, vWP.xz / 12.0).rgb * vec3(0.95, 0.92, 0.9);
  col = mix(col, mud, smoothstep(0.8, 3.5, depth) * 0.6);
}
float slope = 1.0 - clamp(vNW.y, 0.0, 1.0);
if (slope > 0.08) {
  vec3 wall = texture2D(tDirt, vec2(vWP.x - vWP.z, vWP.y * 2.5) / 7.0).rgb;
  wall = mix(vec3(dot(wall, vec3(0.333))), wall, 0.55) * vec3(0.62, 0.55, 0.48);
  col = mix(col, wall, smoothstep(0.08, 0.35, slope));
}
col = mix(col, col * vec3(1.06, 1.03, 0.98), smoothstep(0.5, 2.5, vWP.y));
vec4 dec = texture2D(tDecal, suv);
col = mix(col, dec.rgb, dec.a);
col *= mix(1.0, gwDetail(tDet, vWP.xz), uDetail);
// standing water on the pit floor and in the low ruts
float pn = texture2D(tDet, vWP.xz / 83.0 + 0.37).g * 0.6 + texture2D(tDet, vWP.xz / 29.0 + 0.71).b * 0.4;
float wet = smoothstep(0.47, 0.53, pn) * smoothstep(1.2, 2.6, depth) * (1.0 - smoothstep(0.03, 0.12, slope));
float damp = smoothstep(0.38, 0.5, pn) * smoothstep(0.8, 2.6, depth) * 0.35;
col *= 1.0 - damp;
col = mix(col, col * 0.42 + vec3(0.012, 0.016, 0.02), wet);
col = mix(col, col * vec3(0.10, 0.16, 0.30) + vec3(0.004, 0.012, 0.03), uNervous);
diffuseColor.rgb *= col;`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.05, wet * (1.0 - uNervous));\nroughnessFactor = mix(roughnessFactor, 0.7, damp);')
  }
  return m
}

function cityMaterial(tex: THREE.Texture, det: THREE.Texture) {
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 })
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNervous = groundUniforms.uNervous
    sh.uniforms.tDet = { value: det }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvCW = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uNervous;\nuniform sampler2D tDet;\nvarying vec3 vCW;\n${DETAIL}`)
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= mix(1.0, gwDetail(tDet, vCW.xz), 0.6);\ndiffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.08, 0.13, 0.26), uNervous);')
  }
  return m
}

// Tyre and bucket marks stamped live from the twin, faded slowly.
function useDecalLayer() {
  return useMemo(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 1024
    const g = c.getContext('2d')!
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    return { c, g, tex }
  }, [])
}

export function Ground() {
  const urls = useMemo(() => Object.values(TEX), [])
  const loaded = useLoader(THREE.ImageLoader, urls) as HTMLImageElement[]
  const imgs = useMemo(() => Object.fromEntries((Object.keys(TEX) as TexKey[]).map((k, i) => [k, loaded[i]])) as Imgs, [loaded])
  const gl = useThree((s) => s.gl)
  const aniso = Math.min(8, gl.capabilities.getMaxAnisotropy())

  const geo = useMemo(() => buildGrid(N0, EXT), [])
  const decal = useDecalLayer()
  const mud = useMemo(() => texFrom(imgs.tracks), [imgs])
  const dirt = useMemo(() => texFrom(imgs.dirt), [imgs])
  const siteTex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 2048
    const g = c.getContext('2d')!
    g.fillStyle = '#7a6150'
    g.fillRect(0, 0, 2048, 2048)
    return canvasTex(c, aniso)
  }, [aniso])
  const det = useMemo(() => texFrom(imgs.detail), [imgs])
  const mat = useMemo(() => terrainMaterial(siteTex, mud, dirt, decal.tex, det), [siteTex, mud, dirt, decal, det])
  const cityTex = useMemo(() => canvasTex(paintCity(imgs), aniso), [imgs, aniso])
  const cityMat = useMemo(() => cityMaterial(cityTex, det), [cityTex, det])
  const cityGeo = useMemo(() => {
    const s = new THREE.Shape([new THREE.Vector2(-CITY.size / 2, -CITY.size / 2), new THREE.Vector2(CITY.size / 2, -CITY.size / 2), new THREE.Vector2(CITY.size / 2, CITY.size / 2), new THREE.Vector2(-CITY.size / 2, CITY.size / 2)])
    const h = CITY.hole / 2 - 0.05
    s.holes.push(new THREE.Path([new THREE.Vector2(-h, -h), new THREE.Vector2(-h, h), new THREE.Vector2(h, h), new THREE.Vector2(h, -h)]))
    const g = new THREE.ShapeGeometry(s)
    const uv = g.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / CITY.size + 0.5, uv.getY(i) / CITY.size + 0.5)
    g.rotateX(-Math.PI / 2)
    return g
  }, [])

  const siteVer = useRef(-1)
  const painting = useRef(false)
  const drapedAt = useRef(-1e9)
  const terrainVer = useRef(-1)
  const normalTick = useRef(0)
  const stampAt = useRef(0)
  const uploadAt = useRef(0)
  const last = useRef(new Map<string, [number, number]>())

  const cut = useMemo(() => {
    const t = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat)
    t.colorSpace = THREE.SRGBColorSpace
    t.magFilter = THREE.LinearFilter
    t.minFilter = THREE.LinearFilter
    return t
  }, [])
  const cutMat = useMemo(() => new THREE.MeshBasicMaterial({ map: cut, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, toneMapped: false }), [cut])
  const showCut = useUi((s) => s.overlays.cutfill && s.cam !== 'nervous')

  useEffect(() => () => geo.dispose(), [geo])

  useFrame((_, dt) => {
    groundUniforms.uNervous.value = nervous.k
    if (hot.siteVersion !== siteVer.current && !painting.current) {
      siteVer.current = hot.siteVersion
      painting.current = true
      if (hot.terrain) paintCutFill(cut, hot.terrain)
      paintSite(imgs, hot.site).then((c) => {
        ;(siteTex.image as HTMLCanvasElement).getContext('2d')!.drawImage(c, 0, 0)
        siteTex.needsUpdate = true
        painting.current = false
      })
    }
    if (hot.terrain && hot.terrainVersion !== terrainVer.current) {
      terrainVer.current = hot.terrainVersion
      setTarget(hot.terrain)
      paintCutFill(cut, hot.terrain)
    }
    const morphing = stepMorph(dt)
    const { shown, n, extent } = groundState
    if (shown && n > 1 && (morphing || normalTick.current === 0)) {
      if ((geo.attributes.position as THREE.BufferAttribute).count !== n * n) {
        const ng = buildGrid(n, extent)
        geo.setAttribute('position', ng.attributes.position)
        geo.setAttribute('uv', ng.attributes.uv)
        geo.setIndex(ng.index)
      }
      const arr = (geo.attributes.position as THREE.BufferAttribute).array as Float32Array
      for (let k = 0; k < n * n; k++) arr[k * 3 + 1] = shown[k]
      geo.attributes.position.needsUpdate = true
      normalTick.current++
      if (normalTick.current % 8 === 1 || groundState.morph >= 1) {
        geo.computeVertexNormals()
        geo.computeBoundingSphere()
      }
      if (groundState.morph >= 1 && performance.now() - drapedAt.current > 12000) {
        drapedAt.current = performance.now()
        useUi.setState((s) => ({ terrainShown: s.terrainShown + 1 }))
      }
    }

    const now = performance.now()
    if (now - stampAt.current > 250 && hot.curr) {
      stampAt.current = now
      const { g } = decal
      const px = (x: number) => ((x + EXT / 2) / EXT) * 1024
      const py = (y: number) => ((EXT / 2 - y) / EXT) * 1024
      for (const m of hot.curr.machines) {
        const prev = last.current.get(m.id)
        last.current.set(m.id, [m.x, m.y])
        if (!prev || m.kind.includes('drone') || m.kind.includes('crane')) continue
        const d = Math.hypot(m.x - prev[0], m.y - prev[1])
        if (d < 0.05 || d > 8) continue
        const tracked = /excav|dozer|pil/.test(m.kind)
        const half = tracked ? 1.3 : 1.1
        const nx = -Math.sin(m.heading), ny = Math.cos(m.heading)
        g.strokeStyle = tracked ? 'rgba(52, 38, 28, 0.32)' : 'rgba(46, 34, 24, 0.26)'
        g.lineWidth = tracked ? 3.2 : 2.4
        g.lineCap = 'round'
        for (const s of [-half, half]) {
          g.beginPath()
          g.moveTo(px(prev[0] + nx * s), py(prev[1] + ny * s))
          g.lineTo(px(m.x + nx * s), py(m.y + ny * s))
          g.stroke()
        }
      }
      for (const m of hot.curr.machines) {
        if (!m.kind.includes('excav')) continue
        const sw = m.heading + (m.joints.swing ?? 0)
        const reach = 7 + Math.cos(m.joints.stick ?? -1) * 2
        if ((m.joints.boom ?? 1) < 0.3) {
          const bx = m.x + Math.cos(sw) * reach, by = m.y + Math.sin(sw) * reach
          g.fillStyle = 'rgba(40, 28, 20, 0.12)'
          g.beginPath()
          g.ellipse(px(bx), py(by), 5, 3, -sw, 0, Math.PI * 2)
          g.fill()
        }
      }
    }
    if (now - uploadAt.current > 1000) {
      uploadAt.current = now
      const { g } = decal
      g.globalCompositeOperation = 'destination-out'
      g.fillStyle = 'rgba(0,0,0,0.01)'
      g.fillRect(0, 0, 1024, 1024)
      g.globalCompositeOperation = 'source-over'
      decal.tex.needsUpdate = true
    }
  })

  return (
    <group>
      <mesh geometry={geo} material={mat} receiveShadow name="ground" />
      <mesh geometry={geo} material={cutMat} visible={showCut} renderOrder={1} />
      <mesh geometry={cityGeo} material={cityMat} receiveShadow position={[0, -0.02, 0]} />
      {!location.search.includes('nocity') && <City />}
      {!location.search.includes('nodress') && <Dressing />}
    </group>
  )
}

// Blue where the pit is still above the design surface, amber where fill has been placed since shift start.
function inPoly(x: number, y: number, poly: [number, number][]) {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

function paintCutFill(tex: THREE.DataTexture, t: Terrain) {
  const n = t.n
  const data = new Uint8Array(n * n * 4)
  const pit = hot.site?.pit ?? null
  const dz = t.designZ ?? hot.site?.designDepth ?? null
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const k = j * n + i
      const x = -t.extent / 2 + (i / (n - 1)) * t.extent
      const y = -t.extent / 2 + (j / (n - 1)) * t.extent
      let r = 0, g = 0, b = 0, a = 0
      if (pit && dz !== null && inPoly(x, y, pit)) {
        const left = t.heights[k] - dz
        if (left > 0.1) {
          const q = Math.min(1, left / 6)
          r = 40 + (1 - q) * 80; g = 140 + (1 - q) * 80; b = 255; a = 45 + q * 95
        } else {
          r = 62; g = 230; b = 168; a = 90
        }
      } else if (t.delta) {
        const d = t.delta[k]
        if (isFinite(d) && Math.abs(d) > 0.15) {
          const q = Math.min(1, Math.abs(d) / 3)
          if (d > 0) { r = 255; g = 150 + (1 - q) * 60; b = 30 } else { r = 60; g = 160; b = 255 }
          a = 60 + q * 120
        }
      }
      data[k * 4] = r; data[k * 4 + 1] = g; data[k * 4 + 2] = b; data[k * 4 + 3] = a
    }
  tex.image = { data, width: n, height: n }
  tex.needsUpdate = true
}

import * as THREE from 'three'
import { dimWithNervous } from '../materials'

// Photographic machine materials: PBR paint with wear worked out in world space, so every part of every
// machine gets mud low down, dust on the tops and grime streaks without a texture per part.

let noiseTex: THREE.DataTexture | null = null

// Tiling value noise, three octaves, for wear masks.
function noise(): THREE.DataTexture {
  if (noiseTex) return noiseTex
  const N = 256
  const base = (n: number, seed: number) => {
    const g = new Float32Array(n * n)
    let s = seed
    for (let i = 0; i < g.length; i++) {
      s = (s * 1664525 + 1013904223) >>> 0
      g[i] = s / 4294967296
    }
    return g
  }
  const out = new Uint8Array(N * N * 4)
  const octs = [
    { n: 8, g: base(8, 11), w: 0.5 },
    { n: 32, g: base(32, 23), w: 0.3 },
    { n: 128, g: base(128, 37), w: 0.2 },
  ]
  const sample = (o: { n: number; g: Float32Array }, x: number, y: number) => {
    const fx = (x / N) * o.n, fy = (y / N) * o.n
    const x0 = Math.floor(fx), y0 = Math.floor(fy)
    const tx = fx - x0, ty = fy - y0
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty)
    const at = (a: number, b: number) => o.g[((b % o.n) + o.n) % o.n * o.n + (((a % o.n) + o.n) % o.n)]
    return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy
  }
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let v = 0
      for (const o of octs) v += sample(o, x, y) * o.w
      const k = (y * N + x) * 4
      out[k] = out[k + 1] = out[k + 2] = Math.round(v * 255)
      out[k + 3] = Math.round(sample(octs[2], x * 3, y * 3) * 255)
    }
  noiseTex = new THREE.DataTexture(out, N, N, THREE.RGBAFormat)
  noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping
  noiseTex.magFilter = THREE.LinearFilter
  noiseTex.minFilter = THREE.LinearMipmapLinearFilter
  noiseTex.generateMipmaps = true
  noiseTex.needsUpdate = true
  return noiseTex
}

export interface Wear {
  mud?: number // how high mud reaches, metres above the ground
  mudAmt?: number
  dust?: number // dust on upward faces
  grime?: number // vertical streaks
  chips?: number // paint chipped to bare metal on edges
}

const MUD = new THREE.Color('#5a4632')
const DUST = new THREE.Color('#b7a58a')

const ALWAYS = { value: 1 }

export function weather<T extends THREE.MeshStandardMaterial>(m: T, w: Wear = {}, on: { value: number } = ALWAYS): T {
  const u = {
    uWearOn: on,
    uNoise: { value: noise() },
    uMud: { value: w.mud ?? 1.1 },
    uMudAmt: { value: w.mudAmt ?? 0.75 },
    uDust: { value: w.dust ?? 0.45 },
    uGrime: { value: w.grime ?? 0.35 },
    uChips: { value: w.chips ?? 0.25 },
    uMudCol: { value: MUD },
    uDustCol: { value: DUST },
  }
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * objectNormal);')
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWPos;
varying vec3 vWNrm;
uniform sampler2D uNoise;
uniform float uMud, uMudAmt, uDust, uGrime, uChips, uWearOn;
uniform vec3 uMudCol, uDustCol;
float gwN(vec2 p) { return texture2D(uNoise, p).r; }
float gwTri(vec3 p, vec3 n, float s) {
  vec3 a = abs(n);
  return (gwN(p.yz * s) * a.x + gwN(p.xz * s) * a.y + gwN(p.xy * s) * a.z) / (a.x + a.y + a.z);
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
{
  vec3 n = normalize(vWNrm);
  float big = gwTri(vWPos, n, 0.09);
  float fine = gwTri(vWPos, n, 0.9);
  // mud thrown up from the ground, ragged at its top edge
  float mud = (1.0 - smoothstep(uMud * (0.55 + 0.6 * big), uMud * (0.9 + 0.6 * big), vWPos.y)) * uMudAmt;
  mud *= 0.65 + 0.35 * fine;
  // dust settles on what faces up
  float dust = smoothstep(0.45, 0.95, n.y) * uDust * (0.4 + 0.9 * big) * (0.7 + 0.3 * fine);
  // grime runs down the sides
  float streak = texture2D(uNoise, vec2((vWPos.x + vWPos.z) * 1.7, vWPos.y * 0.12)).g;
  float grime = (1.0 - abs(n.y)) * smoothstep(0.45, 0.85, streak) * uGrime;
  // chips where the noise peaks on any face
  float chip = smoothstep(0.82, 0.9, gwTri(vWPos, n, 2.6)) * uChips;
  mud *= uWearOn;
  dust *= uWearOn;
  grime *= uWearOn;
  chip *= uWearOn;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.19, 0.18), chip);
  diffuseColor.rgb *= 1.0 - grime * 0.45;
  diffuseColor.rgb = mix(diffuseColor.rgb, uDustCol * (0.8 + 0.3 * fine), clamp(dust, 0.0, 0.85));
  diffuseColor.rgb = mix(diffuseColor.rgb, uMudCol * (0.75 + 0.4 * fine), clamp(mud, 0.0, 0.95));
  roughnessFactor = clamp(roughnessFactor + mud * 0.35 + dust * 0.3 - chip * 0.2, 0.04, 1.0);
}`,
      )
  }
  m.customProgramCacheKey = () => `gw-wear-${w.mud ?? 1.1}-${w.dust ?? 0.45}-${w.grime ?? 0.35}`
  m.needsUpdate = true
  dimWithNervous(m)
  return m
}

const std = (o: THREE.MeshStandardMaterialParameters, w?: Wear) => weather(new THREE.MeshStandardMaterial(o), w)

// Tread and decal textures drawn once on canvases.
function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d')!)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 8
  return t
}

// Chevron tyre tread, as a bump map running around the tyre.
const treadBump = () =>
  canvas(256, 256, (g) => {
    g.fillStyle = '#202020'
    g.fillRect(0, 0, 256, 256)
    g.fillStyle = '#e0e0e0'
    for (let y = 0; y < 256; y += 32) {
      g.beginPath()
      g.moveTo(0, y)
      g.lineTo(128, y + 16)
      g.lineTo(256, y)
      g.lineTo(256, y + 14)
      g.lineTo(128, y + 30)
      g.lineTo(0, y + 14)
      g.fill()
    }
  }, false)

// Track shoes: one grouser bar per 0.2 m.
const grouserBump = () =>
  canvas(64, 256, (g) => {
    g.fillStyle = '#1a1a1a'
    g.fillRect(0, 0, 64, 256)
    for (let y = 0; y < 256; y += 32) {
      g.fillStyle = '#d8d8d8'
      g.fillRect(0, y, 64, 9)
      g.fillStyle = '#5a5a5a'
      g.fillRect(0, y + 9, 64, 3)
    }
  }, false)

// Engine grilles and walkway plates.
const grilleBump = () =>
  canvas(128, 128, (g) => {
    g.fillStyle = '#cfcfcf'
    g.fillRect(0, 0, 128, 128)
    g.fillStyle = '#202020'
    for (let y = 4; y < 128; y += 10) g.fillRect(6, y, 116, 5)
  }, false)

const treadPlate = () =>
  canvas(128, 128, (g) => {
    g.fillStyle = '#404040'
    g.fillRect(0, 0, 128, 128)
    g.fillStyle = '#d0d0d0'
    for (let y = 0; y < 128; y += 16)
      for (let x = (y / 16) % 2 ? 8 : 0; x < 128; x += 16) {
        g.save()
        g.translate(x + 4, y + 8)
        g.rotate(((y / 16) % 2 ? 1 : -1) * 0.8)
        g.fillRect(-5, -1.5, 10, 3)
        g.restore()
      }
  }, false)

// Loose soil: clods and stones, seeded so it is the same every render.
const soilTex = () =>
  canvas(256, 256, (g) => {
    let seed = 19
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
    g.fillStyle = '#806a50'
    g.fillRect(0, 0, 256, 256)
    for (let i = 0; i < 2600; i++) {
      const v = 70 + rnd() * 90
      g.fillStyle = `rgb(${v + 30},${v + 12},${v - 10})`
      const r = 0.6 + rnd() * rnd() * 6
      g.beginPath()
      g.arc(rnd() * 256, rnd() * 256, r, 0, Math.PI * 2)
      g.fill()
    }
  })

const tex = { tread: treadBump(), grouser: grouserBump(), grille: grilleBump(), plate: treadPlate(), soil: soilTex() }
tex.soil.repeat.set(3, 3)

export const HD = {
  paint: std({ color: '#bf8e1b', roughness: 0.5, metalness: 0.1 }, { mud: 1.2, dust: 0.65, grime: 0.45, chips: 0.3 }),
  paintArm: std({ color: '#b2851a', roughness: 0.54, metalness: 0.1 }, { mud: 0.6, dust: 0.5, grime: 0.55, chips: 0.45 }),
  frame: std({ color: '#2c2b29', roughness: 0.62, metalness: 0.4 }, { mud: 1.6, mudAmt: 0.9, dust: 0.55, grime: 0.3, chips: 0.15 }),
  black: std({ color: '#1b1c1e', roughness: 0.55, metalness: 0.2 }, { mud: 1.0, dust: 0.5, grime: 0.2, chips: 0.1 }),
  grille: std({ color: '#26272a', roughness: 0.6, metalness: 0.4, bumpMap: tex.grille, bumpScale: 4 }, { mud: 0.8, dust: 0.45, grime: 0.2, chips: 0 }),
  plate: std({ color: '#5b5d60', roughness: 0.5, metalness: 0.8, bumpMap: tex.plate, bumpScale: 3 }, { mud: 0.8, dust: 0.6, grime: 0.2, chips: 0 }),
  steel: std({ color: '#7b7f84', roughness: 0.4, metalness: 0.85 }, { mud: 1.0, dust: 0.4, grime: 0.3, chips: 0 }),
  wornSteel: std({ color: '#6a6660', roughness: 0.5, metalness: 0.8 }, { mud: 1.4, mudAmt: 0.9, dust: 0.5, grime: 0.2, chips: 0 }),
  chrome: std({ color: '#d4d8dc', roughness: 0.12, metalness: 1.0 }, { mud: 0.3, mudAmt: 0.3, dust: 0.1, grime: 0.05, chips: 0 }),
  rubber: std({ color: '#171717', roughness: 0.9, metalness: 0.0, bumpMap: tex.tread, bumpScale: 6 }, { mud: 1.8, mudAmt: 0.85, dust: 0.6, grime: 0.1, chips: 0 }),
  track: std({ color: '#2a2724', roughness: 0.75, metalness: 0.55, bumpMap: tex.grouser, bumpScale: 8 }, { mud: 1.4, mudAmt: 0.95, dust: 0.6, grime: 0.1, chips: 0 }),
  rim: std({ color: '#b2851a', roughness: 0.55, metalness: 0.2 }, { mud: 1.8, mudAmt: 0.85, dust: 0.4, grime: 0.3, chips: 0.3 }),
  glass: new THREE.MeshPhysicalMaterial({ color: '#202a30', roughness: 0.04, metalness: 0.0, envMapIntensity: 1.6, clearcoat: 1, clearcoatRoughness: 0.05 }),
  seat: std({ color: '#141414', roughness: 0.8 }, { mud: 0, mudAmt: 0, dust: 0.1, grime: 0, chips: 0 }),
  orange: std({ color: '#e0601a', roughness: 0.5, metalness: 0.05 }, { mud: 1.0, dust: 0.3, grime: 0.2, chips: 0.2 }),
  light: new THREE.MeshStandardMaterial({ color: '#fff7e0', emissive: new THREE.Color('#fff2cc'), emissiveIntensity: 0.6, roughness: 0.2 }),
  beacon: new THREE.MeshStandardMaterial({ color: '#ffb020', emissive: new THREE.Color('#ff9a00'), emissiveIntensity: 1.8, roughness: 0.3 }),
  sheet: std({ color: '#6a6660', roughness: 0.55, metalness: 0.75, side: THREE.DoubleSide }, { mud: 1.4, mudAmt: 0.9, dust: 0.5, grime: 0.2, chips: 0 }),
  paintSheet: std({ color: '#bf8e1b', roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide }, { mud: 1.2, dust: 0.5, grime: 0.4, chips: 0.35 }),
  soil: std({ color: '#ffffff', map: tex.soil, roughness: 1.0, metalness: 0.0, bumpMap: tex.soil, bumpScale: 3 }, { mud: 0, mudAmt: 0, dust: 0.3, grime: 0, chips: 0 }),
}
dimWithNervous(HD.glass)

// Fleet numbers and warning stripes, fictional fleet only.
const decals = new Map<string, THREE.MeshStandardMaterial>()

export function fleetDecal(text: string, light = false): THREE.MeshStandardMaterial {
  const key = text + light
  let m = decals.get(key)
  if (m) return m
  const t = canvas(256, 128, (g) => {
    g.clearRect(0, 0, 256, 128)
    g.fillStyle = light ? '#f1efe8' : '#151515'
    let px = 96
    g.font = `800 ${px}px "Arial Narrow", Arial, sans-serif`
    while (g.measureText(text).width > 236 && px > 30) g.font = `800 ${(px -= 4)}px "Arial Narrow", Arial, sans-serif`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(text, 128, 68)
    // worn edges, seeded so every render wears the same way
    g.globalCompositeOperation = 'destination-out'
    let seed = 7
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
    for (let i = 0; i < 220; i++) {
      g.fillStyle = `rgba(0,0,0,${rnd() * 0.6})`
      g.fillRect(rnd() * 256, rnd() * 128, 2 + rnd() * 5, 1 + rnd() * 3)
    }
  })
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  m = new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
  dimWithNervous(m)
  decals.set(key, m)
  return m
}

let stripes: THREE.MeshStandardMaterial | null = null
export function stripeDecal(): THREE.MeshStandardMaterial {
  if (stripes) return stripes
  const t = canvas(256, 64, (g) => {
    g.fillStyle = '#e8b21a'
    g.fillRect(0, 0, 256, 64)
    g.fillStyle = '#151515'
    for (let x = -64; x < 256; x += 40) {
      g.beginPath()
      g.moveTo(x, 64)
      g.lineTo(x + 20, 64)
      g.lineTo(x + 84, 0)
      g.lineTo(x + 64, 0)
      g.fill()
    }
  })
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  stripes = weather(new THREE.MeshStandardMaterial({ map: t, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2 }), { mud: 1.2, dust: 0.4, grime: 0.4, chips: 0.3 })
  return stripes
}

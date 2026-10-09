import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

export const COLORS = {
  yellow: '#f2b10f',
  grey: '#2b3038',
  greyLight: '#555c66',
  sky: '#5cc8ff',
  ice: '#c9ecff',
  amber: '#ffb020',
  red: '#ff4d5e',
  mint: '#3ee6a8',
}

const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o)

export const MAT = {
  paint: std({ color: COLORS.yellow, roughness: 0.42, metalness: 0.15 }),
  paintDirty: std({ color: '#d9a21a', roughness: 0.62, metalness: 0.1 }),
  dark: std({ color: COLORS.grey, roughness: 0.55, metalness: 0.35 }),
  darkMatte: std({ color: '#1d2127', roughness: 0.85, metalness: 0.1 }),
  steel: std({ color: '#8b939c', roughness: 0.35, metalness: 0.85 }),
  rubber: std({ color: '#141619', roughness: 0.92, metalness: 0 }),
  glass: std({ color: '#0d2238', roughness: 0.08, metalness: 0.6, envMapIntensity: 1.4 }),
  accent: std({ color: COLORS.sky, roughness: 0.35, metalness: 0.2, emissive: new THREE.Color(COLORS.sky), emissiveIntensity: 0.25 }),
  white: std({ color: '#e9edf2', roughness: 0.5, metalness: 0.05 }),
  concrete: std({ color: '#a9a69e', roughness: 0.9, metalness: 0 }),
  rebar: std({ color: '#6b4a34', roughness: 0.7, metalness: 0.6 }),
  timber: std({ color: '#b08a5a', roughness: 0.85, metalness: 0 }),
  soil: std({ color: '#6e5440', roughness: 1, metalness: 0 }),
  hivisOrange: std({ color: '#ff7a1a', roughness: 0.6, emissive: new THREE.Color('#ff5a00'), emissiveIntensity: 0.12 }),
  hivisLime: std({ color: '#c8f03c', roughness: 0.6, emissive: new THREE.Color('#9fd400'), emissiveIntensity: 0.12 }),
  skin: std({ color: '#c99a78', roughness: 0.8 }),
  trousers: std({ color: '#24324a', roughness: 0.85 }),
  hatWhite: std({ color: '#f4f6f8', roughness: 0.35 }),
  hatBlue: std({ color: '#3a7bd5', roughness: 0.35 }),
  beacon: std({ color: '#ffb020', emissive: new THREE.Color('#ff9a00'), emissiveIntensity: 1.6, roughness: 0.3 }),
}

const nervousTargets = [MAT.paint, MAT.paintDirty, MAT.dark, MAT.darkMatte, MAT.steel, MAT.white, MAT.concrete, MAT.timber, MAT.glass]
const base = new Map(nervousTargets.map((m) => [m, { color: m.color.clone(), emissive: m.emissive.clone(), ei: m.emissiveIntensity }]))
const nervousTint = new THREE.Color('#0b2350')
const nervousEdge = new THREE.Color('#2a7fd4')

// Dims the shared machine materials towards a blueprint look for the nervous system view.
export function applyNervous(k: number) {
  for (const m of nervousTargets) {
    const b = base.get(m)!
    m.color.copy(b.color).lerp(nervousTint, k * 0.92)
    m.emissive.copy(b.emissive).lerp(nervousEdge, k)
    m.emissiveIntensity = b.ei * (1 - k) + k * 0.22
  }
}

const geoCache = new Map<string, THREE.BufferGeometry>()

export function rbox(w: number, h: number, d: number, r = 0.08): THREE.BufferGeometry {
  const key = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}|${r.toFixed(3)}`
  let g = geoCache.get(key)
  if (!g) {
    g = new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001))
    geoCache.set(key, g)
  }
  return g
}

export function cyl(rt: number, rb: number, h: number, seg = 16): THREE.BufferGeometry {
  const key = `c${rt}|${rb}|${h}|${seg}`
  let g = geoCache.get(key)
  if (!g) {
    g = new THREE.CylinderGeometry(rt, rb, h, seg)
    geoCache.set(key, g)
  }
  return g
}

const decalCache = new Map<string, THREE.MeshStandardMaterial>()

export function numberDecal(text: string, bg = COLORS.yellow, fg = COLORS.grey): THREE.MeshStandardMaterial {
  const key = text + bg + fg
  const hit = decalCache.get(key)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = bg
  g.fillRect(0, 0, 256, 128)
  g.fillStyle = COLORS.sky
  g.fillRect(0, 104, 256, 10)
  g.fillStyle = fg
  g.font = '700 84px Inter, Arial, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, 128, 56)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.1 })
  decalCache.set(key, m)
  return m
}

let hazard: THREE.MeshStandardMaterial | null = null
export function hazardMat(): THREE.MeshStandardMaterial {
  if (hazard) return hazard
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  g.fillStyle = COLORS.yellow
  g.fillRect(0, 0, 64, 64)
  g.fillStyle = '#16181c'
  for (let i = -64; i < 128; i += 32) {
    g.beginPath()
    g.moveTo(i, 0)
    g.lineTo(i + 16, 0)
    g.lineTo(i + 16 + 64, 64)
    g.lineTo(i + 64, 64)
    g.fill()
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(4, 1)
  t.colorSpace = THREE.SRGBColorSpace
  hazard = new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 })
  return hazard
}

let lattice: THREE.MeshStandardMaterial | null = null
export function latticeMat(): THREE.MeshStandardMaterial {
  if (lattice) return lattice
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 128
  const g = c.getContext('2d')!
  g.clearRect(0, 0, 64, 128)
  g.strokeStyle = '#ffffff'
  g.lineWidth = 7
  g.strokeRect(3, 3, 58, 122)
  g.beginPath()
  g.moveTo(3, 3)
  g.lineTo(61, 64)
  g.lineTo(3, 125)
  g.moveTo(3, 64)
  g.lineTo(61, 64)
  g.stroke()
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  lattice = new THREE.MeshStandardMaterial({ map: t, color: COLORS.yellow, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.45, metalness: 0.2 })
  return lattice
}

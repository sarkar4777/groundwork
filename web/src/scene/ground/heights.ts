import type { Terrain } from '../../proto/types'

// The heights currently shown, morphing towards the latest /terrain revision.
export const groundState = {
  n: 0,
  extent: 200,
  shown: null as Float32Array | null,
  target: null as Float32Array | null,
  delta: null as Float32Array | null,
  morph: 1,
}

export function setTarget(t: Terrain) {
  if (!groundState.shown || groundState.n !== t.n) {
    groundState.n = t.n
    groundState.shown = new Float32Array(t.heights)
  }
  groundState.extent = t.extent
  groundState.target = t.heights
  groundState.delta = t.delta
  groundState.morph = 0
}

export function stepMorph(dt: number): boolean {
  const { shown, target } = groundState
  if (!shown || !target || groundState.morph >= 1) return false
  const k = Math.min(1, dt * 1.6)
  for (let i = 0; i < shown.length; i++) shown[i] += (target[i] - shown[i]) * k
  groundState.morph = Math.min(1, groundState.morph + dt * 1.2)
  if (groundState.morph >= 1) shown.set(target)
  return true
}

export function heightAt(x: number, y: number): number {
  const { shown, n, extent } = groundState
  if (!shown || n < 2) return 0
  const fx = ((x + extent / 2) / extent) * (n - 1)
  const fy = ((y + extent / 2) / extent) * (n - 1)
  if (fx < 0 || fy < 0 || fx > n - 1 || fy > n - 1) return 0
  const i = Math.min(n - 2, Math.floor(fx)), j = Math.min(n - 2, Math.floor(fy))
  const u = fx - i, v = fy - j
  const a = shown[j * n + i], b = shown[j * n + i + 1], c = shown[(j + 1) * n + i], d = shown[(j + 1) * n + i + 1]
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v
}

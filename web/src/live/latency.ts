import type { Latency } from '../proto/types'

export const LAYER_KEYS = ['l1_ms', 'l2_ms', 'l3_ms', 'l4_ms', 'l5_ms'] as const
type Key = (typeof LAYER_KEYS)[number]

const CAP = 90
// l4 and l5 report the last call, so only a change counts as a new sample
const PER_CALL = new Set<Key>(['l4_ms', 'l5_ms'])

export const latHistory: Record<Key, number[]> = { l1_ms: [], l2_ms: [], l3_ms: [], l4_ms: [], l5_ms: [] }

export function trackLatency(lat: Partial<Latency> & Record<string, unknown>) {
  for (const k of LAYER_KEYS) {
    const v = lat[k]
    if (typeof v !== 'number' || !isFinite(v) || v <= 0) continue
    const h = latHistory[k]
    if (PER_CALL.has(k) && h.length && h[h.length - 1] === v) continue
    h.push(v)
    if (h.length > CAP) h.shift()
  }
}

export function p50(k: Key, lat?: Record<string, unknown>): number | null {
  const sent = lat?.[k.replace('_ms', '_p50_ms')]
  if (typeof sent === 'number' && isFinite(sent)) return sent
  const h = latHistory[k]
  if (!h.length) return null
  const s = [...h].sort((a, b) => a - b)
  return s[Math.floor((s.length - 1) / 2)]
}

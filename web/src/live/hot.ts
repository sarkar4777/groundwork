import type { AgentFrame, BusFrame, EventFrame, Machine, StateFrame, Terrain, SiteLayout, Crane } from '../proto/types'

// Mutable, render-loop data. React never subscribes to this directly.
export const hot = {
  prev: null as StateFrame | null,
  curr: null as StateFrame | null,
  prevAt: 0,
  currAt: 0,
  busParticles: [] as BusFrame[],
  flashes: [] as EventFrame[],
  arcs: [] as AgentFrame[],
  terrain: null as Terrain | null,
  terrainVersion: 0,
  site: null as SiteLayout | null,
  siteVersion: 0,
  stopFlash: new Map<string, number>(),
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k
const lerpAngle = (a: number, b: number, k: number) => {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * k
}

export function interpAlpha(now = performance.now()): number {
  if (!hot.prev || !hot.curr) return 1
  const span = Math.max(16, hot.currAt - hot.prevAt)
  return Math.min(1, Math.max(0, (now - hot.currAt) / span))
}

export function machineAt(id: string, out: Machine, k: number): Machine | null {
  const c = hot.curr?.machines.find((m) => m.id === id)
  if (!c) return null
  const p = hot.prev?.machines.find((m) => m.id === id) ?? c
  out.id = c.id
  out.kind = c.kind
  out.x = lerp(p.x, c.x, k)
  out.y = lerp(p.y, c.y, k)
  out.z = lerp(p.z ?? 0, c.z ?? 0, k)
  out.heading = lerpAngle(p.heading, c.heading, k)
  out.joints = out.joints || {}
  for (const key in c.joints) {
    const a = p.joints?.[key] ?? c.joints[key]
    out.joints[key] = key === 'swing' || key === 'slew' ? lerpAngle(a, c.joints[key], k) : lerp(a, c.joints[key], k)
  }
  out.speed = c.speed
  out.mode = c.mode
  out.load_t = c.load_t
  out.fuel_pct = c.fuel_pct
  out.health = c.health
  out.task = c.task
  return out
}

export function craneAt(id: string, out: Crane, k: number): Crane | null {
  const c = hot.curr?.cranes?.find((m) => m.id === id)
  if (!c) return null
  const p = hot.prev?.cranes?.find((m) => m.id === id) ?? c
  out.id = c.id
  out.slew = lerpAngle(p.slew, c.slew, k)
  out.luff = lerp(p.luff, c.luff, k)
  out.hook = [lerp(p.hook[0], c.hook[0], k), lerp(p.hook[1], c.hook[1], k), lerp(p.hook[2], c.hook[2], k)]
  out.load_t = c.load_t
  out.lmi_pct = c.lmi_pct
  out.wind_ms = c.wind_ms
  return out
}

export function workerAt(id: string, k: number): { x: number; y: number; heading: number; zone: string; role: string } | null {
  const c = hot.curr?.workers.find((w) => w.id === id)
  if (!c) return null
  const p = hot.prev?.workers.find((w) => w.id === id) ?? c
  return { x: lerp(p.x, c.x, k), y: lerp(p.y, c.y, k), heading: lerpAngle(p.heading, c.heading, k), zone: c.zone, role: c.role }
}

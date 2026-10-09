import type { AgentInfo, SiteLayout, Terrain, Vec2 } from '../proto/types'

const halfTable = (() => {
  const t = new Float32Array(65536)
  for (let h = 0; h < 65536; h++) {
    const s = h & 0x8000 ? -1 : 1
    const e = (h >> 10) & 0x1f
    const f = h & 0x3ff
    t[h] = e === 0 ? s * 2 ** -14 * (f / 1024) : e === 31 ? (f ? NaN : s * Infinity) : s * 2 ** (e - 15) * (1 + f / 1024)
  }
  return t
})()

export function decodeF16(b64: string): Float32Array {
  const bin = atob(b64)
  const n = bin.length >> 1
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = halfTable[bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8)]
  return out
}

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) ? v : d)

function pickString(o: Json, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'string' && v.length > 64) return v
    if (isObj(v)) {
      const inner = pickString(v, ['data', 'b64', 'base64', 'values'])
      if (inner) return inner
    }
  }
  return null
}

export function parseTerrain(j: Json, fallbackRev: number): Terrain {
  const hb = pickString(j, ['heights', 'height', 'heightmap', 'data', 'h', 'z'])
  if (!hb) throw new Error('terrain payload has no heightmap')
  const heights = decodeF16(hb)
  const db = pickString(j, ['delta', 'cut_fill', 'cutfill', 'cut_fill_delta', 'diff', 'dz'])
  const n = num(j.n ?? j.size ?? j.width ?? j.res ?? j.resolution, Math.round(Math.sqrt(heights.length)))
  const extent = num(j.extent ?? j.extent_m ?? j.size_m ?? j.metres ?? j.meters, 200)
  const dz = j.design_z ?? j.designZ
  return { rev: num(j.rev, fallbackRev), n, extent, heights, delta: db ? decodeF16(db) : null, designZ: typeof dz === 'number' ? dz : null }
}

function toPts(v: unknown): Vec2[] | null {
  if (!v) return null
  if (isObj(v)) return toPts(v.polygon ?? v.points ?? v.poly ?? v.coords ?? v.centerline ?? v.centreline ?? v.path ?? v.line)
  if (!Array.isArray(v) || v.length < 2) return null
  const pts: Vec2[] = []
  for (const p of v) {
    if (Array.isArray(p) && p.length >= 2) pts.push([Number(p[0]), Number(p[1])])
    else if (isObj(p)) pts.push([num(p.x, 0), num(p.y, 0)])
  }
  return pts.length >= 2 ? pts : null
}

function rectOrCircle(v: unknown): Vec2[] | null {
  if (!isObj(v)) return toPts(v)
  if (typeof v.r === 'number' || typeof v.radius === 'number') {
    const r = num(v.r ?? v.radius, 10)
    const cx = num(v.x ?? v.cx, 0)
    const cy = num(v.y ?? v.cy, 0)
    return Array.from({ length: 40 }, (_, i) => [cx + Math.cos((i / 40) * Math.PI * 2) * r, cy + Math.sin((i / 40) * Math.PI * 2) * r] as Vec2)
  }
  if (typeof v.x0 === 'number' || typeof v.xmin === 'number') {
    const x0 = num(v.x0 ?? v.xmin, 0), x1 = num(v.x1 ?? v.xmax, 0), y0 = num(v.y0 ?? v.ymin, 0), y1 = num(v.y1 ?? v.ymax, 0)
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
  }
  return toPts(v)
}

function entries(v: unknown): [string, unknown][] {
  if (Array.isArray(v)) return v.map((x, i) => [isObj(x) ? String(x.id ?? x.name ?? i) : String(i), x])
  if (isObj(v)) return Object.entries(v)
  return []
}

export function parseSite(j: Json): SiteLayout {
  const zones: SiteLayout['zones'] = []
  let swingRadius = 0
  for (const [id, z] of entries(j.zones ?? j.geofences ?? j.exclusion_zones)) {
    const o = isObj(z) ? z : {}
    if (/swing/i.test(String(o.kind ?? ''))) {
      swingRadius = Math.max(swingRadius, num(o.r ?? o.radius, 0))
      continue
    }
    const poly = rectOrCircle(z)
    if (!poly) continue
    zones.push({ id, kind: String(o.kind ?? o.type ?? 'zone'), label: String(o.label ?? o.name ?? id), polygon: poly })
  }
  const haulRoads: SiteLayout['haulRoads'] = []
  for (const [id, r] of entries(j.haul_roads ?? j.roads ?? j.haulRoads)) {
    const pts = toPts(r)
    if (!pts) continue
    const o = isObj(r) ? r : {}
    haulRoads.push({ id, label: String(o.label ?? o.name ?? id), points: pts })
  }
  const craneBases: SiteLayout['craneBases'] = []
  for (const [id, c] of entries(j.crane_bases ?? j.cranes)) {
    if (Array.isArray(c) && c.length >= 2) {
      craneBases.push({ id, kind: id.startsWith('M') ? 'mobile' : 'tower', x: Number(c[0]), y: Number(c[1]), radius: id.startsWith('M') ? 32 : 55 })
      continue
    }
    if (!isObj(c)) continue
    const kindRaw = String(c.kind ?? c.type ?? id)
    const kind = /mob/i.test(kindRaw) || /^MC/i.test(id) ? 'mobile' : 'tower'
    craneBases.push({
      id: String(c.id ?? id),
      kind,
      x: num(c.x, 0),
      y: num(c.y, 0),
      radius: num(c.radius ?? c.jib_m ?? c.max_radius ?? c.reach ?? c.r, kind === 'mobile' ? 32 : 55),
    })
  }
  const ds = j.design_surface
  const designDepth = isObj(ds) ? num(ds.depth ?? ds.z ?? ds.level ?? ds.formation_z, -7) : typeof ds === 'number' ? ds : -7
  const gateRaw = j.gate
  const gate: Vec2 | null = Array.isArray(gateRaw) ? [Number(gateRaw[0]), Number(gateRaw[1])] : isObj(gateRaw) ? [num(gateRaw.x, 0), num(gateRaw.y, -100)] : null
  return {
    size: num(j.size ?? j.extent, 200),
    zones,
    haulRoads,
    spoil: rectOrCircle(j.spoil_area ?? j.spoil),
    pit: rectOrCircle(j.pit ?? j.excavation ?? (isObj(ds) ? ds : null)),
    building: rectOrCircle(j.building_footprint ?? j.building),
    craneBases,
    gate,
    designDepth,
    piles: Array.isArray(j.piles) ? (j.piles as unknown[]).filter(Array.isArray).map((p) => [Number((p as number[])[0]), Number((p as number[])[1])] as Vec2) : [],
    swingRadius: swingRadius || 9.8,
  }
}

const LEVELS = ['watching', 'asks first', 'acts and reports', 'acts within limits', 'autonomous']

export function levelIndex(level: string): number {
  const l = level.toLowerCase().replace(/[_-]/g, ' ')
  const i = LEVELS.findIndex((x) => l.includes(x))
  if (i >= 0) return i
  const n = parseInt(l.replace(/\D/g, ''), 10)
  return isFinite(n) ? Math.min(4, Math.max(0, n)) : 0
}

export const LEVEL_NAMES = ['Watching', 'Asks first', 'Acts and reports', 'Acts within limits', 'Autonomous']

export function parseAgents(j: unknown): AgentInfo[] {
  const list = Array.isArray(j) ? j : isObj(j) ? (j.agents ?? j.data ?? j.items ?? []) : []
  if (!Array.isArray(list)) return []
  return list.filter(isObj).map((a) => {
    const name = String(a.name ?? a.slug ?? a.id ?? 'agent')
    const levelRaw = a.level ?? a.autonomy ?? a.autonomy_level ?? a.mode ?? 'watching'
    const level = typeof levelRaw === 'number' ? LEVEL_NAMES[Math.min(4, levelRaw)] : String(levelRaw)
    const actionsRaw = a.actions ?? a.action_types ?? []
    const actions = entries(actionsRaw).map(([k, v]) => {
      const lv = isObj(v) ? String(v.level ?? v.autonomy ?? 'watching') : String(v)
      return { type: isObj(v) ? String(v.type ?? v.action_type ?? k) : k, level: lv === 'undefined' || lv === 'null' ? '' : lv, levelIndex: levelIndex(lv) }
    })
    return {
      name,
      label: String(a.label ?? a.display_name ?? a.title ?? prettyAgent(name)),
      level,
      levelIndex: typeof a.level_index === 'number' ? Math.min(4, Math.max(0, a.level_index)) : levelIndex(level),
      actions,
      record: a.record ? String(a.record) : a.success_rate != null ? `${Math.round(Number(a.success_rate) * 100)}% success` : undefined,
      url: typeof a.url === 'string' ? a.url : undefined,
    }
  })
}

export function prettyAgent(name: string): string {
  return name.replace(/^gw-/, '').split(/[-_]/).map((w) => w[0]?.toUpperCase() + w.slice(1)).join(' ')
}

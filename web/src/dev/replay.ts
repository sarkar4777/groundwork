// Synthesised frames shaped exactly like CONTRACT.md, for building the web before the sim exists.
// Only active with ?replay=1, and the UI labels everything REPLAY while it runs.
import type { AgentFrame, BusFrame, CaptionFrame, EventFrame, Frame, Machine, PlanNode, StateFrame, Worker, Crane, Vec2 } from '../proto/types'
import { REPLAY_SITE } from './layout'

type Emit = (f: Frame) => void

let seed = 7
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}

function f32ToF16(v: number): number {
  const f = new Float32Array([v])
  const x = new Uint32Array(f.buffer)[0]
  const s = (x >>> 16) & 0x8000
  const e = ((x >>> 23) & 0xff) - 112
  const m = (x & 0x7fffff) >>> 13
  if (e <= 0) return s
  if (e >= 31) return s | 0x7c00
  return s | (e << 10) | m
}

function f16b64(a: Float32Array): string {
  const bytes = new Uint8Array(a.length * 2)
  for (let i = 0; i < a.length; i++) {
    const h = f32ToF16(a[i])
    bytes[i * 2] = h & 0xff
    bytes[i * 2 + 1] = h >> 8
  }
  let s = ''
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(s)
}

class Path {
  pts: Vec2[]
  cum: number[] = [0]
  len: number
  constructor(pts: Vec2[]) {
    this.pts = pts
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
    this.len = this.cum[this.cum.length - 1]
  }
  at(s: number): { x: number; y: number; h: number } {
    s = clamp(s, 0, this.len)
    let i = 1
    while (i < this.cum.length - 1 && this.cum[i] < s) i++
    const a = this.pts[i - 1], b = this.pts[i]
    const k = (s - this.cum[i - 1]) / Math.max(1e-6, this.cum[i] - this.cum[i - 1])
    return { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k, h: Math.atan2(b[1] - a[1], b[0] - a[0]) }
  }
}

const spoilPath = new Path([[3, 10], ...REPLAY_SITE.haulRoads[0].points])
const gatePath = new Path([[3, 10], [8, 6], ...REPLAY_SITE.haulRoads[1].points])
const thPath = new Path([[0, -98], [4, -90], [16, -70], [24, -52], [14, -30], [4, -22]])

const PIT = { x0: -55, x1: 22, y0: -18, y1: 42 }

function groundZ(x: number, y: number, depth: number, spoil: number): number {
  const inPit = smooth(-3, 3, x - PIT.x0) * smooth(-3, 3, PIT.x1 - x) * smooth(-3, 3, y - PIT.y0) * smooth(-3, 3, PIT.y1 - y)
  let z = -depth * inPit
  if (x > 0 && x < 34 && y > -1 && y < 14) {
    const edge = smooth(-1, 2, y) * smooth(-14, -11, -y)
    z = Math.max(z, -depth * clamp(1 - (x - 4) / 24, 0, 1) * edge + z * (1 - edge))
  }
  const d2 = (x - 70) ** 2 + (y - 60) ** 2
  z += spoil * Math.exp(-d2 / 300)
  return z
}

const ROLES = ['banksman', 'slinger', 'slinger', 'surveyor', 'surveyor', 'labourer', 'labourer', 'labourer', 'labourer', 'labourer', 'labourer', 'engineer', 'supervisor', 'visitor']
const HOMES: Vec2[] = [[8, 18], [-40, -52], [-48, -58], [-30, 46], [58, 24], [-20, 48], [-62, 0], [-35, -24], [26, 30], [-10, 48], [30, -22], [-75, -80], [-80, -76], [-70, -84]]

const AGENT_LEVELS: Record<string, string> = {
  'gw-site-superintendent': 'asks first',
  'gw-safety-officer': 'acts and reports',
  'gw-crane-coordinator': 'acts within limits',
  'gw-fleet-dispatcher': 'asks first',
  'gw-maintenance-tech': 'acts and reports',
  'gw-earthworks-surveyor': 'watching',
  'gw-compliance-reporter': 'acts and reports',
  'gw-foreman-voice': 'asks first',
}

const ACTIONS: Record<string, string[]> = {
  'gw-site-superintendent': ['gw.plan.change'],
  'gw-safety-officer': ['gw.machine.safe_mode'],
  'gw-crane-coordinator': ['gw.crane.slew_plan'],
  'gw-fleet-dispatcher': ['gw.truck.reroute'],
}

export const STORY_CAPTIONS: [number, number, string][] = [
  [0, 4, 'A construction site that runs itself.\nEvery machine, every decision, on Abenix.'],
  [4, 9, 'A worker walks into the swing zone.\nThe safety layer stops the excavator in 3 ms.'],
  [9, 14, 'Seconds later the AI replans the site\nand asks a person to approve.'],
  [14, 21, 'Underneath, 45 machine controllers talk on real\nmachine buses at 100 times a second.'],
  [21, 28, 'A gust is forecast. The crane holds.\nThe plan changes around it.'],
  [28, 35, 'We switch the AI off. The site stays safe,\nbecause safety never waits for the AI.'],
  [35, 44, 'A new machine arrives. The AI writes its controller,\ntests it, and puts it to work.'],
  [44, 52, 'Agents earn trust from their record.\nMistakes become lessons a person approves.'],
  [52, 60, 'Groundwork. Built on Abenix, open source.'],
]

const ECUS: Record<string, string[]> = {
  excavator: ['ENG', 'HYD', 'SWG', 'TEL', 'SPLC'],
  dozer: ['ENG', 'TRN', 'BLD', 'TEL'],
  haul_truck: ['ENG', 'TRN', 'HST', 'TEL', 'CAS'],
  tower_crane: ['SLW', 'LUF', 'HST', 'LMI', 'ACU'],
  mobile_crane: ['ENG', 'SLW', 'LUF', 'LMI'],
  piling_rig: ['ENG', 'HYD', 'MST'],
  roller: ['ENG', 'VIB', 'TEL'],
  telehandler: ['ENG', 'BOOM', 'TEL'],
  survey_drone: ['FC', 'GNSS', 'CAM'],
}

const SA: Record<string, number> = { ENG: 0, TRN: 3, HYD: 0x23, SWG: 0x24, TEL: 0x4a, SPLC: 0x2a, HST: 0x25, CAS: 0x2b, SLW: 0x30, LUF: 0x31, LMI: 0x32, ACU: 0x33, BLD: 0x26, MST: 0x27, VIB: 0x28, BOOM: 0x29, FC: 0x40, GNSS: 0x1c, CAM: 0x41 }

export class Replay {
  t = 0
  seq = 0
  private emit: Emit
  private timer = 0
  private last = 0
  private busAcc = 0
  private depth = 4.2
  private spoil = 1.2
  private rev = 1
  private m3 = 1840
  private cycles = 212
  private cost = 0.42
  private faults = new Map<string, string>()
  private wind = 7.5
  private gustUntil = -1
  private aiOff = false
  private killed = false
  private intrusionUntil = -1
  private stopSince = -1
  private storyT0 = -1
  private storyFired = new Set<string>()
  private pending: { id: string; agent: string; text: string } | null = null
  private dispatcherPromoted = false
  private thStart = -1e9
  private nextAgentAt = 3
  private nextEventAt = 18
  private planReroute = false
  private workers: { id: string; role: string; x: number; y: number; tx: number; ty: number; h: number; wait: number; home: Vec2 }[]
  private machines: Machine[] = []

  constructor(emit: Emit) {
    this.emit = emit
    this.workers = ROLES.map((role, i) => ({ id: `W${String(i + 1).padStart(2, '0')}`, role, x: HOMES[i][0], y: HOMES[i][1], tx: HOMES[i][0], ty: HOMES[i][1], h: 0, wait: rnd() * 4, home: HOMES[i] }))
  }

  start() {
    this.last = performance.now()
    this.timer = window.setInterval(() => this.tick(), 50)
    this.emitPlan()
  }

  stop() {
    clearInterval(this.timer)
  }

  private tick() {
    const now = performance.now()
    const dt = Math.min(0.2, (now - this.last) / 1000)
    this.last = now
    this.t += dt
    this.seq++
    this.story()
    this.step(dt)
    this.bus(dt)
    this.scripted()
    if (this.seq % 160 === 0) {
      this.depth = Math.min(7.2, this.depth + 0.08)
      this.spoil = Math.min(4.5, this.spoil + 0.05)
      this.rev++
    }
  }

  private machine(id: string, kind: string, x: number, y: number, heading: number, joints: Record<string, number>, extra: Partial<Machine> = {}): Machine {
    const f = this.faults.get(id)
    let mode = this.aiOff || this.killed ? 'fallback' : 'auto'
    let health = 'ok'
    if (f === 'cut_can') { mode = 'fallback'; health = 'fault' }
    if (f === 'drop_gnss') { mode = 'hold'; health = 'warn' }
    const m: Machine = {
      id, kind, x, y, z: groundZ(x, y, this.depth, this.spoil), heading, joints,
      speed: 0, mode, load_t: 0, fuel_pct: 55 + ((id.charCodeAt(id.length - 1) * 7) % 40), health, task: '',
      ...extra,
    }
    if (!extra.mode) m.mode = mode
    return m
  }

  private step(dt: number) {
    const t = this.t
    const ms: Machine[] = []
    const ex1Hold = t < this.intrusionUntil && this.stopSince > 0 || this.faults.get('EX1') === 'drop_gnss'
    const cyc = (t % 20) / 20
    const swingTo = smooth(0.3, 0.5, cyc) - smooth(0.65, 0.85, cyc)
    const prevEx1 = this.machines.find((m) => m.id === 'EX1')
    const ex1Joints = ex1Hold && prevEx1 ? prevEx1.joints : {
      swing: swingTo * Math.PI * 0.95,
      boom: -0.25 + 0.75 * smooth(0.25, 0.45, cyc) - 0.75 * smooth(0.85, 1, cyc),
      stick: 1.3 - 0.9 * smooth(0.05, 0.3, cyc) + 0.9 * smooth(0.6, 0.95, cyc),
      bucket: -0.3 + 1.0 * smooth(0.1, 0.3, cyc) - 1.4 * smooth(0.55, 0.65, cyc),
    }
    ms.push(this.machine('EX1', 'excavator', -6, 10, Math.PI, ex1Joints, {
      task: ex1Hold ? 'hold, worker in swing' : 'load truck HT1', load_t: cyc > 0.3 && cyc < 0.6 ? 2.6 : 0.4,
      mode: ex1Hold ? 'hold' : undefined,
    }))
    if (cyc < 0.05 && !ex1Hold && this.seq % 20 === 0) { this.cycles++; this.m3 += 1.9 }
    const c2 = (t % 28) / 28
    ms.push(this.machine('EX2', 'excavator', -46, 30, Math.PI * 0.75, {
      swing: Math.sin(c2 * Math.PI * 2) * 0.5, boom: 0.1 + Math.sin(c2 * Math.PI * 4) * 0.2, stick: 0.9 + Math.sin(c2 * Math.PI * 2) * 0.4, bucket: 0.3,
    }, { task: 'trim north batter' }))

    ;['HT1', 'HT2', 'HT3', 'HT4', 'HT5', 'HT6'].forEach((id, i) => {
      const path = i < 4 ? spoilPath : gatePath
      const dwellA = 18, dwellB = 10, v = 6.5
      const T = dwellA + path.len / v + dwellB + path.len / v
      const ph = (t + i * (T / (i < 4 ? 4 : 2)) + (i >= 4 ? 30 : 0)) % T
      let s = 0, dir = 1, body = 0, spd = 0, load = 0, task = ''
      if (ph < dwellA) { s = 0; load = 18 * (ph / dwellA); task = 'loading at EX1' }
      else if (ph < dwellA + path.len / v) { s = (ph - dwellA) * v; spd = v; load = 24; task = i < 4 ? 'haul to spoil' : 'off-site load to gate' }
      else if (ph < dwellA + path.len / v + dwellB) { s = path.len; body = Math.sin(((ph - dwellA - path.len / v) / dwellB) * Math.PI) * 0.9; load = 24 * (1 - body); task = 'tipping' }
      else { s = path.len - (ph - dwellA - path.len / v - dwellB) * v; dir = -1; spd = v; task = 'return to pit' }
      if (ph < dwellA && i > 0) s = 3 + i * 0.5
      if (id === 'HT4' && this.planReroute) task += ', rerouted'
      const p = path.at(s)
      const f = this.faults.get(id)
      const stopped = f === 'drop_gnss' || f === 'cut_can'
      ms.push(this.machine(id, 'haul_truck', p.x, p.y, dir > 0 ? p.h : p.h + Math.PI, { body, steer: 0 }, { speed: stopped ? 0 : spd, load_t: load, task }))
    })

    const dzc = (t % 16) / 16
    ms.push(this.machine('DZ1', 'dozer', 58 + Math.sin(dzc * Math.PI * 2) * 12, 70, Math.cos(dzc * Math.PI * 2) > 0 ? 0 : Math.PI, { blade: 0.2 }, { speed: 2.2, task: 'spread spoil' }))
    const rcc = (t % 22) / 22
    ms.push(this.machine('RC1', 'roller', 82, 46 + Math.sin(rcc * Math.PI * 2) * 14, Math.cos(rcc * Math.PI * 2) > 0 ? Math.PI / 2 : -Math.PI / 2, { drum: t * 3 }, { speed: 1.6, task: 'compact lift 3' }))
    ms.push(this.machine('PR1', 'piling_rig', 66, -24, Math.PI / 2, { mast: 1.0, auger: t * 4, depth: 6 + Math.sin(t * 0.2) * 5 }, { task: 'pile P14 east wall' }))
    const thS = Math.min(thPath.len, (t - this.thStart) * 4)
    const thp = thPath.at(thS)
    ms.push(this.machine('TH1', 'telehandler', thp.x, thp.y, thp.h, { boom: 0.3, extension: 0.4 }, { task: thS < thPath.len ? 'driving on site' : 'stage formwork', speed: thS < thPath.len ? 4 : 0 }))
    ;([['DR1', 0], ['DR2', Math.PI]] as [string, number][]).forEach(([id, ph]) => {
      const a = t * 0.05 + ph
      const d = this.machine(id, 'survey_drone', Math.cos(a) * 70, Math.sin(a) * 70, a + Math.PI / 2, { rotor: t * 60 }, { task: 'progress scan', speed: 3.5 })
      d.z = 55
      ms.push(d)
    })

    const gust = t < this.gustUntil
    this.wind += ((gust ? 21.5 : 7.5 + Math.sin(t * 0.13) * 1.5) - this.wind) * Math.min(1, dt * 0.8)

    const tcCycle = (t % 40) / 40
    const tcBase = REPLAY_SITE.craneBases[0]
    const slew = gust ? 2.2 : -0.8 + 2.6 * (smooth(0.1, 0.4, tcCycle) - smooth(0.6, 0.9, tcCycle)) + 1.0
    const luff = 0.55 + 0.35 * Math.sin(tcCycle * Math.PI * 2)
    const jib = 55, mastH = 48
    const r = Math.cos(luff) * jib
    const hookZ = 10 + 12 * Math.abs(Math.sin(tcCycle * Math.PI * 2))
    const loaded = tcCycle > 0.15 && tcCycle < 0.6
    const tc: Crane = { id: 'TC1', slew, luff, hook: [tcBase.x + Math.cos(slew) * r, tcBase.y + Math.sin(slew) * r, gust ? 4 : hookZ], load_t: loaded || gust ? 2.4 : 0, lmi_pct: Math.round(loaded ? 55 + 30 * (1 - luff) : 18), wind_ms: +(this.wind * 1.2).toFixed(1) }
    void mastH
    const mcBase = REPLAY_SITE.craneBases[1]
    const ms2 = 2.2 + Math.sin(t * 0.07) * 0.7
    const ml = 0.9 + Math.sin(t * 0.05) * 0.1
    const mr = Math.cos(ml) * 34
    const mc: Crane = { id: 'MC1', slew: ms2, luff: ml, hook: [mcBase.x + Math.cos(ms2) * mr, mcBase.y + Math.sin(ms2) * mr, 8], load_t: 1.1, lmi_pct: 44, wind_ms: +this.wind.toFixed(1) }
    ms.push(this.machine('TC1', 'tower_crane', tcBase.x, tcBase.y, 0, { slew, luff }, { task: gust ? 'hold, gust forecast' : 'lift rebar cage B2', load_t: tc.load_t, mode: gust ? 'hold' : undefined }))
    ms.push(this.machine('MC1', 'mobile_crane', mcBase.x, mcBase.y, Math.PI / 2, { slew: ms2, luff: ml }, { task: 'formwork panels', load_t: 1.1 }))

    const ex1 = ms[0]
    for (const w of this.workers) {
      if (w.id === 'W07' && t < this.intrusionUntil) { w.tx = ex1.x + 5; w.ty = ex1.y - 4; w.wait = 3 }
      const dx = w.tx - w.x, dy = w.ty - w.y, d = Math.hypot(dx, dy)
      if (d < 0.3) {
        w.wait -= dt
        if (w.wait < 0) {
          w.tx = w.home[0] + (rnd() - 0.5) * 18
          w.ty = w.home[1] + (rnd() - 0.5) * 18
          w.wait = 2 + rnd() * 6
        }
      } else {
        const v = (w.id === 'W07' && t < this.intrusionUntil ? 2.6 : 1.3) * dt
        w.x += (dx / d) * Math.min(v, d)
        w.y += (dy / d) * Math.min(v, d)
        w.h = Math.atan2(dy, dx)
      }
    }
    const workers: Worker[] = this.workers.map((w) => {
      let zone = 'ok'
      for (const m of ms) {
        if (m.kind !== 'excavator') continue
        const dd = Math.hypot(w.x - m.x, w.y - m.y)
        if (dd < 9.5) zone = 'danger'
        else if (dd < 14 && zone !== 'danger') zone = 'warn'
      }
      const moving = Math.hypot(w.tx - w.x, w.ty - w.y) > 0.5
      const v = w.id === 'W07' && t < this.intrusionUntil ? 2.6 : 1.3
      const predicted: [number, number][] | undefined = moving ? [1, 2, 3].map((k) => [+(w.x + Math.cos(w.h) * v * k).toFixed(2), +(w.y + Math.sin(w.h) * v * k).toFixed(2)] as [number, number]) : undefined
      return { id: w.id, role: w.role, x: +w.x.toFixed(2), y: +w.y.toFixed(2), heading: w.h, zone, predicted }
    })

    this.machines = ms
    const stops = ex1Hold && this.stopSince > 0 ? [{ machine: 'EX1', rule: 'worker_in_swing', since: +this.stopSince.toFixed(2) }] : []
    if (gust) stops.push({ machine: 'TC1', rule: 'wind_over_limit', since: +(this.gustUntil - 12).toFixed(2) })
    const jitter = () => 0.85 + rnd() * 0.3
    if (!(this.aiOff || this.killed)) this.cost += 0.00004
    const state: StateFrame = {
      type: 'state', t: +this.t.toFixed(3), seq: this.seq,
      machines: ms, workers, cranes: [tc, mc],
      terrain: { rev: this.rev },
      sensors: { wind_ms: +this.wind.toFixed(1), gust_ms: +(this.wind * 1.3).toFixed(1), dust_ugm3: Math.round(36 + Math.sin(t * 0.1) * 6), noise_db: Math.round(72 + Math.sin(t * 0.3) * 4), wall_tilt_mm: +(1.1 + Math.sin(t * 0.01) * 0.2).toFixed(2) },
      safety: { envelope: stops.length ? 'stop' : workers.some((w) => w.zone === 'warn') ? 'warn' : 'ok', active_stops: stops },
      latency: { l1_ms: +(2.1 * jitter()).toFixed(2), l2_ms: +(0.4 * jitter()).toFixed(2), l3_ms: +(18 * jitter()).toFixed(1), l4_ms: Math.round(140 * jitter()), l5_ms: Math.round(2800 * jitter()) },
      kpi: { m3_moved: Math.round(this.m3), cycles: this.cycles, trucks_waiting: Math.floor(t / 11) % 3 === 0 ? 1 : 0, ai_cost_usd: +this.cost.toFixed(3) },
    }
    this.emit(state)
  }

  private bus(dt: number) {
    this.busAcc += dt * 180
    const n = Math.floor(this.busAcc)
    this.busAcc -= n
    for (let i = 0; i < n; i++) {
      const m = this.machines[Math.floor(rnd() * this.machines.length)]
      if (!m) continue
      if (this.faults.get(m.id) === 'cut_can') continue
      if (rnd() < 0.08) { this.emit(this.sparkplug()); continue }
      const ecus = ECUS[m.kind] ?? ['ENG']
      this.emit(this.j1939(m, ecus[Math.floor(rnd() * ecus.length)]))
    }
  }

  private j1939(m: Machine, ecu: string): BusFrame {
    const b = new Uint8Array(8).fill(0xff)
    const dv = new DataView(b.buffer)
    let pgn = 61444, name = 'Electronic Engine Controller 1', decoded: Record<string, unknown> = {}
    const sa = SA[ecu] ?? 0
    const r = rnd()
    if (ecu === 'ENG' || ecu === 'FC') {
      if (r < 0.5) {
        const rpm = 1450 + rnd() * 400
        dv.setUint16(3, Math.round(rpm / 0.125), true)
        b[2] = 125 + Math.round(rnd() * 60)
        decoded = { engine_rpm: Math.round(rpm), torque_pct: b[2] - 125 }
      } else if (r < 0.8) {
        pgn = 65262; name = 'Engine Temperature 1'
        const c = 86 + Math.round(rnd() * 6); b[0] = c + 40
        decoded = { coolant_c: c }
      } else {
        pgn = 65266; name = 'Fuel Economy'
        const lph = 18 + rnd() * 14
        dv.setUint16(0, Math.round(lph / 0.05), true)
        decoded = { fuel_rate_lph: +lph.toFixed(1) }
      }
    } else if (ecu === 'TEL' || ecu === 'GNSS') {
      pgn = 65267; name = 'Vehicle Position 1'
      dv.setUint32(0, Math.round((51.5 + m.y / 111000 + 210) * 1e7), true)
      dv.setUint32(4, Math.round((-0.1 + m.x / 70000 + 210) * 1e7), true)
      decoded = { e_m: +m.x.toFixed(2), n_m: +m.y.toFixed(2), fix: m.health === 'ok' ? 'RTK fixed' : 'float', sats: 21 + Math.floor(rnd() * 5) }
    } else if (ecu === 'LMI') {
      pgn = 65300; name = 'LMI status (proprietary B)'
      b[0] = Math.round(40 + rnd() * 20); b[1] = Math.round(this.wind * 4)
      decoded = { lmi_pct: b[0], wind_ms: +this.wind.toFixed(1), load_t: m.load_t }
    } else if (ecu === 'SPLC' || ecu === 'CAS' || ecu === 'ACU') {
      pgn = 65226; name = 'DM1 Active Diagnostic Trouble Codes'
      b.fill(0, 0, 6)
      decoded = { lamp: 'off', active_dtcs: 0 }
    } else {
      pgn = 65281 + (sa % 8); name = 'Hydraulic pressure (proprietary B)'
      const bar = 180 + rnd() * 140
      dv.setUint16(0, Math.round(bar * 10), true)
      b[2] = Math.round(50 + rnd() * 10)
      decoded = { pressure_bar: Math.round(bar), oil_c: b[2] }
    }
    return { type: 'bus', t: +this.t.toFixed(3), machine: m.id, ecu, pgn, sa, data: Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(''), name, decoded, proto: 'j1939' }
  }

  private sparkplug(): BusFrame {
    const sensors: [string, string, Record<string, unknown>][] = [
      ['wind01', 'Wind speed TC1', { wind_ms: +this.wind.toFixed(1) }],
      ['dust03', 'Dust PM10 gate', { dust_ugm3: Math.round(36 + rnd() * 8) }],
      ['tilt02', 'Retaining wall tilt', { wall_tilt_mm: +(1.1 + rnd() * 0.2).toFixed(2) }],
      ['noise01', 'Noise boundary N', { noise_db: Math.round(70 + rnd() * 6) }],
    ]
    const [dev, name, decoded] = sensors[Math.floor(rnd() * sensors.length)]
    return { type: 'bus', t: +this.t.toFixed(3), machine: 'SITE', ecu: dev, pgn: 0, sa: 0, data: '', name, decoded: { ...decoded, seq: this.seq % 256 }, proto: 'sparkplug', topic: `spBv1.0/northgate/DDATA/edge1/${dev}` }
  }

  private event(kind: string, title: string, detail = '', machine?: string, extra: Record<string, unknown> = {}) {
    const e: EventFrame = { type: 'event', t: +this.t.toFixed(2), kind, title, detail, machine, ...extra }
    this.emit(e)
  }

  private agent(agent: string, phase: string, text: string, execution_id?: string) {
    if (this.aiOff || this.killed) return
    this.cost += 0.004
    const f: AgentFrame = { type: 'agent', t: +this.t.toFixed(2), agent, phase, text, execution_id }
    this.emit(f)
  }

  private emitPlan() {
    const gust = this.t < this.gustUntil
    const held = this.t < this.intrusionUntil && this.stopSince > 0
    const tree: PlanNode = {
      id: 'root', label: 'Shift plan, Northgate Yard', status: 'running', children: [
        { id: 'dig', label: 'Bulk excavation, basement B2', status: 'running', children: [
          { id: 'ex1', label: held ? 'EX1 held by safety layer' : 'EX1 load trucks HT1 to HT4', status: held ? 'failure' : 'running' },
          { id: 'ex2', label: 'EX2 trim north batter', status: 'running' },
        ] },
        { id: 'haul', label: 'Haulage', status: 'running', children: [
          { id: 'spoil', label: 'Spoil runs, 4 trucks', status: 'running' },
          { id: 'gate', label: 'Off-site loads, 2 trucks', status: 'running' },
          ...(this.planReroute ? [{ id: 'reroute', label: 'Reroute HT4 via gate road', status: this.pending ? 'pending' : 'running' }] : []),
        ] },
        { id: 'lifts', label: 'Crane lifts', status: 'running', children: [
          { id: 'tc1', label: gust ? 'TC1 hold, gust forecast 21 m/s' : 'TC1 rebar cages to level B2', status: gust ? 'failure' : 'running' },
          { id: 'mc1', label: this.planReroute ? 'MC1 formwork lift moved 90 s' : 'MC1 formwork panels', status: this.planReroute && this.pending ? 'pending' : 'running' },
        ] },
        { id: 'pile', label: 'Piling, east wall P14 to P22', status: 'running' },
        { id: 'pour', label: 'Concrete pour, raft bay 3', status: 'idle' },
      ],
    }
    this.emit({ type: 'plan', t: +this.t.toFixed(2), tree })
  }

  private scripted() {
    const t = this.t
    if (t >= this.nextAgentAt) {
      this.nextAgentAt = t + 5 + rnd() * 5
      const lines: [string, string, string][] = [
        ['gw-fleet-dispatcher', 'tool', 'dispatch.solve: 6 trucks, queue at EX1 is 1, cycle 4.2 min'],
        ['gw-crane-coordinator', 'thinking', 'Wind 8 m/s, LMI 52 percent, next lift within limits'],
        ['gw-earthworks-surveyor', 'answer', 'DR1 scan: 62 percent of B2 cut done, 410 m3 left on the north side'],
        ['gw-maintenance-tech', 'thinking', 'HT2 coolant up 2 C over 10 min, watching'],
        ['gw-site-superintendent', 'thinking', 'Shift on plan. Pour at 16:00 needs the pump bay clear by 15:30'],
        ['gw-safety-officer', 'answer', 'Exclusion zones clear. 14 tags online'],
      ]
      const [a, p, x] = lines[Math.floor(rnd() * lines.length)]
      this.agent(a, p, x)
    }
    if (t >= this.nextEventAt && this.storyT0 < 0) {
      this.nextEventAt = t + 20 + rnd() * 15
      const r = rnd()
      if (r < 0.4) this.event('near_miss', 'Near miss', 'W11 within 12 m of HT5 at 6 km/h, speed capped to 10 km/h', 'HT5', { ms: 2.4 })
      else if (r < 0.7) this.event('plan_change', 'Dispatch updated', 'HT3 swapped to the gate run, queue at EX1 down to 0', 'HT3')
      else this.event('gust', 'Gust nowcast', 'Next 60 s gust 14 m/s, under the 20 m/s crane limit', 'TC1')
    }
    if (this.seq % 40 === 0) this.emitPlan()
  }

  private story() {
    if (this.storyT0 < 0) return
    const s = this.t - this.storyT0
    const once = (k: string, at: number, fn: () => void) => {
      if (s >= at && !this.storyFired.has(k)) { this.storyFired.add(k); fn() }
    }
    STORY_CAPTIONS.forEach(([a, b, text], i) => once('cap' + i, a, () => {
      const c: CaptionFrame = { type: 'caption', t: +(this.storyT0 + a).toFixed(2), text, until: +(this.storyT0 + b).toFixed(2) }
      this.emit(c)
    }))
    once('intrude', 3.2, () => this.fault('worker_in_swing', 'EX1'))
    once('replan', 9.0, () => this.replan())
    once('gust', 21.5, () => this.fault('gust', 'TC1'))
    once('aioff', 28.5, () => this.fault('ai_offline'))
    once('aion', 35, () => {
      this.fault('clear')
      this.thStart = this.t
      this.event('story', 'TH1 on site', 'AI-written controller passed 24 of 24 golden tests', 'TH1')
    })
    once('promote', 45, () => this.promote())
    once('lesson', 48, () => this.event('approval', 'Lesson proposed', 'Near miss NM-0412 to rule change: swing margin plus 1.5 m when the banksman is absent', 'EX1'))
    once('end', 60, () => { this.event('story', 'Story finished', ''); this.storyT0 = -1 })
  }

  private replan() {
    this.planReroute = true
    const id = 'exec-' + Math.floor(rnd() * 1e8).toString(16)
    this.agent('gw-site-superintendent', 'thinking', 'EX1 held by the safety layer. Queue at EX1 reaches 3 trucks in 90 s')
    this.agent('gw-site-superintendent', 'tool', 'twin.query, dispatch.solve, crane.lift_plan')
    this.pending = { id, agent: 'gw-site-superintendent', text: 'Rerouting truck HT4, crane MC1 lift moved 90 s. Approve?' }
    this.agent('gw-site-superintendent', 'waiting_approval', this.pending.text, id)
    this.event('plan_change', 'Replan proposed', 'Reroute HT4 via gate road, MC1 lift moved 90 s', 'HT4')
    this.emitPlan()
  }

  private promote() {
    this.dispatcherPromoted = true
    this.event('autonomy', 'Fleet Dispatcher promoted', 'gw.truck.reroute moves from Asks first to Acts within limits after 50 approved reroutes and 0 overrides', undefined, { agent: 'gw-fleet-dispatcher', level: 'acts within limits' })
  }

  fault(kind: string, target?: string) {
    const t = this.t
    switch (kind) {
      case 'worker_in_swing':
        this.intrusionUntil = t + 7
        this.stopSince = -1
        setTimeout(() => {
          this.stopSince = this.t
          this.event('safety_stop', 'Safety stop', 'Worker W07 inside swing radius of EX1', 'EX1', { ms: +(2.8 + rnd() * 0.5).toFixed(1), rule: 'worker_in_swing' })
          this.emitPlan()
        }, 1500)
        break
      case 'gust':
        this.gustUntil = t + 12
        this.event('gust', 'Gust forecast', 'Nowcast 21 m/s in 40 s, over the 20 m/s slew limit. TC1 holds its load', 'TC1')
        this.agent('gw-crane-coordinator', 'answer', 'Holding TC1, rebar cage parked at 4 m. MC1 lift goes first')
        this.emitPlan()
        break
      case 'ai_offline':
        this.event('fault', 'AI offline, site safe', 'Abenix unreachable. Fallback plan active, safety layer unchanged', undefined, { ai_offline: true })
        this.aiOff = true
        break
      case 'kill_switch':
        this.agent('gw-site-superintendent', 'answer', 'Kill switch received. Stopping at this step')
        this.killed = true
        this.event('fault', 'Kill switch', 'Every agent stopped. Machines run on rules and the fallback plan')
        break
      case 'clear':
        this.faults.clear()
        this.aiOff = false
        this.killed = false
        this.gustUntil = -1
        this.intrusionUntil = -1
        this.event('fault', 'Faults cleared', 'AI back online, site on the AI plan', undefined, { ai_offline: false })
        break
      default:
        if (target) {
          this.faults.set(target, kind)
          setTimeout(() => this.faults.delete(target), 30000)
          this.event('fault', kind === 'cut_can' ? `CAN bus cut on ${target}` : `GNSS lost on ${target}`, kind === 'cut_can' ? 'No frames on the bus. Safety PLC took the machine to fallback' : 'RTK fix lost for 1 s. Machine holds', target, { ms: +(1 + rnd()).toFixed(1) })
        }
    }
  }

  startStory() {
    this.storyFired.clear()
    this.fault('clear')
    this.storyT0 = this.t
    this.thStart = -1e9
    this.planReroute = false
    this.pending = null
    this.dispatcherPromoted = false
    this.event('story', 'Story started', 'Fixed seed 7')
  }

  stopStory() {
    this.storyT0 = -1
  }

  approve(id: string | undefined, decision: string) {
    if (!this.pending || (id && id !== this.pending.id)) return false
    const p = this.pending
    this.pending = null
    this.event('approval', decision === 'approve' ? 'Approved by site manager' : 'Rejected by site manager', p.text, 'HT4', { execution_id: p.id })
    this.agent(p.agent, 'answer', decision === 'approve' ? 'Approved. HT4 rerouted, MC1 lift moved 90 s' : 'Rejected. Keeping the current plan', p.id)
    this.emitPlan()
    return true
  }

  agents() {
    return Object.entries(AGENT_LEVELS).map(([name, level]) => {
      const lv = name === 'gw-fleet-dispatcher' && this.dispatcherPromoted ? 'acts within limits' : level
      return {
        name,
        level: lv,
        actions: (ACTIONS[name] ?? []).map((type) => ({ type, level: lv })),
        record: name === 'gw-fleet-dispatcher' ? (this.dispatcherPromoted ? '50 approved, 0 overrides' : '49 approved, 0 overrides') : undefined,
      }
    })
  }

  site() {
    return REPLAY_SITE
  }

  terrain() {
    const n = 256, ext = 200
    const h = new Float32Array(n * n), d = new Float32Array(n * n)
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = -ext / 2 + (i / (n - 1)) * ext
      const y = -ext / 2 + (j / (n - 1)) * ext
      const ripple = Math.sin(x * 0.7 + y * 0.3) * 0.05 + Math.sin(x * 0.13 - y * 0.21) * 0.2
      const z = groundZ(x, y, this.depth, this.spoil) + ripple
      h[j * n + i] = z
      const inPit = x > PIT.x0 && x < PIT.x1 && y > PIT.y0 && y < PIT.y1
      d[j * n + i] = inPit ? z - REPLAY_SITE.designDepth : groundZ(x, y, 0, this.spoil) - groundZ(x, y, 0, 0)
    }
    return { rev: this.rev, n, extent: ext, heights: f16b64(h), delta: f16b64(d) }
  }
}

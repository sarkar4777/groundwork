import type { AgentFrame, BusFrame, EventFrame, FaultKind, Frame, StateFrame } from '../proto/types'
import { REPLAY, SIM_HTTP, wsUrl } from './config'
import { hot } from './hot'
import { parseAgents, parseSite, parseTerrain } from './parse'
import { toast, useUi, type Approval } from './store'
import type { Replay } from '../dev/replay'

let replay: Replay | null = null
let ws: WebSocket | null = null
let retry = 0
let lastFrameAt = 0
let terrainRev = -1
let terrainBusy = false

export interface EcuStat { ecu: string; sa: number; count: number; last: number; lastAt: number; name: string; pgn: number; rate: number; decoded: Record<string, unknown>; proto?: string }
export const ecuStats = new Map<string, Map<string, EcuStat>>()
export const busRate = { n: 0, at: performance.now(), perSec: 0, ticks: 0, ticksPerSec: 0, agents: 0 }

function trackBus(f: BusFrame) {
  let m = ecuStats.get(f.machine)
  if (!m) ecuStats.set(f.machine, (m = new Map()))
  const now = performance.now()
  const s = m.get(f.ecu)
  if (!s) {
    m.set(f.ecu, { ecu: f.ecu, sa: f.sa, count: 1, last: f.t, lastAt: now, name: f.name, pgn: f.pgn, rate: 0, decoded: f.decoded, proto: f.proto })
    return
  }
  const dt = Math.max(0.001, (now - s.lastAt) / 1000)
  s.rate = s.rate ? s.rate * 0.85 + (1 / dt) * 0.15 : 1 / dt
  s.count++
  s.last = f.t
  s.lastAt = now
  s.name = f.name
  s.pgn = f.pgn
  s.sa = f.sa
  s.decoded = f.decoded
}

const BUS_TRACE_CAP = 400
const PARTICLE_CAP = 400

const pending = {
  state: null as StateFrame | null,
  bus: [] as BusFrame[],
  events: [] as EventFrame[],
  agents: [] as AgentFrame[],
  dirty: false,
}

export async function startClient() {
  setInterval(flush, 80)
  if (REPLAY) {
    const { Replay } = await import('../dev/replay')
    replay = new Replay(ingest)
    useUi.setState({ conn: 'replay', abenix: { url: 'replay', reachable: false } })
    replay.start()
    loadSite()
    refreshAgents()
    return
  }
  connect()
  loadHealth()
  setInterval(() => {
    if (useUi.getState().conn === 'live' && performance.now() - lastFrameAt > 4000) {
      ws?.close()
    }
  }, 1000)
}

function connect() {
  useUi.setState((s) => ({ conn: s.conn === 'live' ? 'connecting' : s.conn }))
  try {
    ws = new WebSocket(wsUrl())
  } catch (e) {
    scheduleReconnect(String(e))
    return
  }
  ws.onopen = () => {
    retry = 0
    lastFrameAt = performance.now()
    useUi.setState({ conn: 'live', connError: null })
    loadSite()
    refreshAgents()
    loadHealth()
  }
  ws.onmessage = (ev) => {
    lastFrameAt = performance.now()
    try {
      const data = JSON.parse(typeof ev.data === 'string' ? ev.data : '')
      if (Array.isArray(data)) data.forEach(ingest)
      else ingest(data)
    } catch {
      /* drop malformed frame */
    }
  }
  ws.onclose = () => scheduleReconnect('connection closed')
  ws.onerror = () => {
    /* onclose follows */
  }
}

function scheduleReconnect(reason: string) {
  ws = null
  useUi.setState({ conn: 'offline', connError: reason })
  const delay = Math.min(8000, 600 * 2 ** retry++)
  setTimeout(connect, delay)
}

export function ingest(f: Frame) {
  switch (f.type) {
    case 'state': {
      const now = performance.now()
      if (hot.curr && f.t < hot.curr.t - 1) {
        hot.prev = null
      } else {
        hot.prev = hot.curr
        hot.prevAt = hot.currAt
      }
      hot.curr = f
      hot.currAt = now
      pending.state = f
      pending.dirty = true
      busRate.ticks++
      if (f.terrain && f.terrain.rev !== terrainRev) loadTerrain(f.terrain.rev)
      trackStory(f.t)
      break
    }
    case 'bus':
      trackBus(f)
      busRate.n++
      if (hot.busParticles.length < PARTICLE_CAP) hot.busParticles.push(f)
      if (!useUi.getState().tracePaused) pending.bus.push(f)
      pending.dirty = true
      break
    case 'event':
      hot.flashes.push(f)
      if (f.kind === 'safety_stop' && f.machine) hot.stopFlash.set(f.machine, performance.now())
      pending.events.push(f)
      pending.dirty = true
      onEvent(f)
      break
    case 'agent':
      hot.arcs.push(f)
      pending.agents.push(f)
      pending.dirty = true
      onAgent(f)
      break
    case 'plan':
      useUi.setState({ plan: f.tree, planT: f.t })
      break
    case 'caption': {
      const s = useUi.getState()
      const log = s.story.running ? [...s.captionLog.filter((c) => c.t !== f.t), { t: f.t, until: f.until, text: f.text }] : s.captionLog
      useUi.setState({ caption: f, captionLog: log })
      break
    }
  }
}

function flush() {
  const now = performance.now()
  if (now - busRate.at >= 1000) {
    const k = 1000 / (now - busRate.at)
    busRate.perSec = Math.round(busRate.n * k)
    busRate.ticksPerSec = Math.round(busRate.ticks * k)
    busRate.n = 0
    busRate.ticks = 0
    busRate.at = now
  }
  if (!pending.dirty) return
  pending.dirty = false
  const s = useUi.getState()
  const next: Partial<typeof s> = {}
  if (pending.state) next.state = pending.state
  if (pending.bus.length) {
    const merged = s.bus.concat(pending.bus)
    next.bus = merged.length > BUS_TRACE_CAP ? merged.slice(merged.length - BUS_TRACE_CAP) : merged
    pending.bus = []
  }
  if (pending.events.length) {
    next.events = s.events.concat(pending.events).slice(-120)
    pending.events = []
  }
  if (pending.agents.length) {
    next.agentLines = s.agentLines.concat(pending.agents).slice(-80)
    pending.agents = []
  }
  pending.state = null
  useUi.setState(next)
}

function onEvent(e: EventFrame) {
  const text = `${e.title} ${e.detail ?? ''}`
  if (e.ai_offline === true || (e.kind === 'fault' && /ai offline/i.test(text))) useUi.setState({ aiOffline: true })
  if (e.ai_offline === false || /faults cleared|ai (back )?online|ai restored/i.test(text)) useUi.setState({ aiOffline: false, killed: false })
  if (e.kind === 'fault' && /kill switch/i.test(e.title)) useUi.setState({ killed: true })
  if (e.kind === 'autonomy') refreshAgents()
  if (e.kind === 'approval') {
    const id = typeof e.execution_id === 'string' ? e.execution_id : undefined
    if (id || /approved|rejected/i.test(e.title)) {
      useUi.setState((s) => ({
        approvals: s.approvals.map((a) =>
          (id ? a.execution_id === id : a.status === 'pending' || a.status === 'sending') ? { ...a, status: /reject/i.test(e.title) ? 'rejected' : 'approved' } : a,
        ),
      }))
    }
  }
  if (e.kind === 'story') {
    if (/finish|end|stop/i.test(e.title)) useUi.setState((s) => ({ story: { ...s.story, running: false } }))
    else if (/start/i.test(e.title)) useUi.setState((s) => ({ story: { ...s.story, running: true, t0: e.t, startedAt: performance.now() }, captionLog: [] }))
  }
}

function onAgent(a: AgentFrame) {
  if (a.phase === 'waiting_approval') {
    const key = a.execution_id || `${a.agent}-${a.t}`
    useUi.setState((s) => {
      if (s.approvals.some((x) => x.key === key)) return s
      const ap: Approval = { key, execution_id: a.execution_id, agent: a.agent, text: a.text, t: a.t, status: 'pending' }
      return { approvals: [...s.approvals.slice(-5), ap] }
    })
  } else if (a.execution_id && a.phase === 'answer') {
    useUi.setState((s) => ({
      approvals: s.approvals.map((x) => (x.execution_id === a.execution_id && x.status !== 'pending' ? x : x.execution_id === a.execution_id ? { ...x, status: /reject/i.test(a.text) ? 'rejected' : 'approved' } : x)),
    }))
  }
}

function trackStory(t: number) {
  const s = useUi.getState().story
  if (!s.running) return
  if (t < s.t0 - 1) useUi.setState({ story: { ...s, t0: t } })
  if (t - s.t0 > 64) useUi.setState({ story: { ...s, running: false } })
}

async function getJson(path: string): Promise<unknown> {
  const r = await fetch(SIM_HTTP + path, { headers: { accept: 'application/json' } })
  if (!r.ok) throw new Error(`${path} returned ${r.status}`)
  return r.json()
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  const r = await fetch(SIM_HTTP + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const text = await r.text()
  if (!r.ok) throw new Error(text.slice(0, 160) || `${path} returned ${r.status}`)
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

async function loadTerrain(rev: number) {
  if (terrainBusy) return
  terrainBusy = true
  try {
    const j = replay ? replay.terrain() : await getJson(`/terrain?rev=${rev}`)
    hot.terrain = parseTerrain(j as Record<string, unknown>, rev)
    hot.terrainVersion++
    terrainRev = rev
  } catch (e) {
    console.warn('terrain', e)
    terrainRev = rev
  } finally {
    terrainBusy = false
  }
}

async function loadSite() {
  try {
    const j = replay ? replay.site() : await getJson('/site')
    hot.site = replay ? (j as typeof hot.site) : parseSite(j as Record<string, unknown>)
    hot.siteVersion++
    useUi.setState({ siteError: null, siteVersion: hot.siteVersion })
  } catch (e) {
    useUi.setState({ siteError: String(e instanceof Error ? e.message : e) })
  }
}

async function loadHealth() {
  if (replay) return
  try {
    const j = (await getJson('/health')) as Record<string, unknown>
    const ab = (j.abenix ?? {}) as Record<string, unknown>
    const url = String(ab.url ?? j.abenix_url ?? import.meta.env.VITE_ABENIX_URL ?? 'http://localhost:8000')
    const reachable = Boolean(typeof j.abenix === 'boolean' ? j.abenix : ab.ok ?? ab.reachable ?? j.abenix_ok ?? j.abenix_reachable)
    useUi.setState({ abenix: { url, reachable } })
  } catch {
    /* status pill covers this */
  }
}

export async function refreshAgents() {
  try {
    const j = replay ? replay.agents() : await getJson('/agents')
    useUi.setState({ agents: parseAgents(j), agentsError: null })
  } catch (e) {
    useUi.setState({ agentsError: String(e instanceof Error ? e.message : e) })
  }
}

export async function sendFault(kind: FaultKind, target?: string): Promise<boolean> {
  try {
    if (replay) replay.fault(kind, target)
    else await postJson('/fault', target ? { kind, target } : { kind })
    if (kind === 'ai_offline') useUi.setState({ aiOffline: true })
    if (kind === 'kill_switch') useUi.setState({ killed: true })
    if (kind === 'clear') useUi.setState({ aiOffline: false, killed: false })
    toast(kind === 'clear' ? 'Faults cleared' : `Sent ${kind.replace(/_/g, ' ')}${target ? ' to ' + target : ''}`, kind === 'clear' ? 'ok' : 'warn')
    return true
  } catch (e) {
    toast(`Fault not sent: ${e instanceof Error ? e.message : e}`, 'err')
    return false
  }
}

export async function startStory(): Promise<boolean> {
  const s = useUi.getState()
  useUi.setState({ story: { running: true, t0: s.state?.t ?? 0, startedAt: performance.now(), error: null }, captionLog: [], caption: null })
  try {
    if (replay) replay.startStory()
    else await postJson('/story/start', {})
    return true
  } catch (e) {
    useUi.setState({ story: { running: false, t0: 0, startedAt: 0, error: String(e instanceof Error ? e.message : e) } })
    toast('Story did not start. Is the sim running?', 'err')
    return false
  }
}

export async function stopStory() {
  useUi.setState((s) => ({ story: { ...s.story, running: false }, caption: null }))
  try {
    if (replay) replay.stopStory()
    else await postJson('/story/stop', {})
  } catch {
    /* already stopped locally */
  }
}

export async function approve(a: Approval, decision: 'approve' | 'reject') {
  const set = (patch: Partial<Approval>) => useUi.setState((s) => ({ approvals: s.approvals.map((x) => (x.key === a.key ? { ...x, ...patch } : x)) }))
  set({ status: 'sending', error: undefined })
  try {
    if (replay) replay.approve(a.execution_id, decision)
    else await postJson('/approve', { execution_id: a.execution_id, decision, approved: decision === 'approve' })
    set({ status: decision === 'approve' ? 'approved' : 'rejected' })
  } catch (e) {
    set({ status: 'error', error: String(e instanceof Error ? e.message : e) })
  }
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { useUi, type Approval } from '../live/store'
import { approve, ecuStats, refreshAgents, sendFault } from '../live/client'
import { ECU_NAMES, Icon, Panel, fmtMs, fmtT, modeTone, signalName } from '../ui/kit'
import { LEVEL_NAMES, prettyAgent } from '../live/parse'
import type { BusFrame, FaultKind, LoopRecord, PlanNode } from '../proto/types'
import { REPLAY } from '../live/config'
import { hot } from '../live/hot'
import { hasServerP50, latHistory, p50 } from '../live/latency'

function useNow(hz: number) {
  const [, set] = useState(0)
  useEffect(() => {
    const id = setInterval(() => set((x) => x + 1), 1000 / hz)
    return () => clearInterval(id)
  }, [hz])
}

export function VecuConsole({ focus }: { focus?: boolean }) {
  useNow(4)
  const ids = useUi((s) => s.state?.machines.map((m) => m.id).join('|') ?? '')
  const sel = useUi((s) => s.selected)
  const [pick, setPick] = useState<string>('')
  const machineId = pick || (sel && ids.split('|').includes(sel) ? sel : ids.split('|')[0] || '')
  const m = useUi((s) => s.state?.machines.find((x) => x.id === machineId))
  const reported = useUi((s) => s.state?.vecus)
  const total = reported ?? [...ecuStats.entries()].filter(([k]) => k !== 'SITE').reduce((a, [, e]) => a + e.size, 0)
  const ecus = [...(ecuStats.get(machineId)?.values() ?? [])].sort((a, b) => a.ecu.localeCompare(b.ecu))
  const now = performance.now()
  return (
    <Panel id="vecu" title="vECU console" icon="chip" focus={focus} extra={<span className="chip" title="Controllers seen on the bus">{total} vECUs</span>}>
      {!ids ? (
        <div><div className="skeleton" /><div className="skeleton" style={{ width: '70%' }} /></div>
      ) : (
        <>
          <div className="toolbar">
            <label className="sr-only" htmlFor="vecu-m">Machine</label>
            <select id="vecu-m" className="select" value={machineId} onChange={(e) => setPick(e.target.value)}>
              {ids.split('|').map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
            {m?.src === 'ipc' && <span className={`chip ${m.online === false ? 'stop' : 'ai'}`} title={`${m.node}: real ECUs on a J1939 bus, through Abenix telemetry`}>IPC · real bus</span>}
            {m && <span className={`chip ${modeTone(m.mode)}`}>{m.mode}</span>}
            {m && <span className={`chip ${m.health === 'ok' ? 'ok' : m.health === 'warn' ? 'warn' : 'stop'}`}>{m.health}</span>}
          </div>
          {m && <div className="muted" style={{ fontSize: 12, marginBottom: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.kind.replace(/_/g, ' ')} · {m.task || 'no task'}</div>}
          <div className="list">
            {ecus.length === 0 && <div className="empty">No frames from {machineId} yet{m?.health === 'fault' ? ', bus is down' : ''}</div>}
            {ecus.map((e) => {
              const age = (now - e.lastAt) / 1000
              const state = age < 2 ? 'live' : age < 6 ? 'stale' : 'silent'
              const first = Object.entries(e.decoded).find(([k]) => k !== 'seq')
              return (
                <div className="row" key={e.ecu} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 2 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ECU_NAMES[e.ecu] ?? e.ecu}</div>
                    <div className="mono faint" style={{ fontSize: 10.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {e.proto === 'sparkplug' ? 'Sparkplug B' : `SA 0x${e.sa.toString(16).padStart(2, '0')} · PGN ${e.pgn}`} {first ? `· ${first[0]} ${String(first[1])}` : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span className={`chip ${state === 'live' ? 'ok' : state === 'stale' ? 'warn' : 'stop'}`}>{state}</span>
                    <div className="mono faint" style={{ fontSize: 10 }}>{e.rate ? `${e.rate.toFixed(1)} Hz seen` : '--'}</div>
                  </div>
                </div>
              )
            })}
          </div>
          {m && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              {m.src === 'ipc' ? (
                <>
                  <button className="btn sm amber" onClick={() => sendFault('unplug_pc', machineId)} disabled={m.online === false}>Unplug {machineId}'s PC</button>
                  <button className="btn sm amber" onClick={() => sendFault('noisy_harness', machineId)} disabled={m.online === false}>Noisy harness</button>
                </>
              ) : (
                <>
                  <button className="btn sm amber" onClick={() => sendFault('cut_can', machineId)}>Cut CAN on {machineId}</button>
                  <button className="btn sm amber" onClick={() => sendFault('drop_gnss', machineId)}>Drop GNSS</button>
                </>
              )}
            </div>
          )}
        </>
      )}
    </Panel>
  )
}

const hex = (s: string) => s.replace(/(..)/g, '$1 ').trim().toUpperCase()

function fmtValue(v: unknown): string {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2)
  if (Array.isArray(v)) return v.length ? `[${v.map(fmtValue).join(', ')}]` : 'none'
  if (v && typeof v === 'object') return Object.entries(v).map(([k, x]) => `${k}:${fmtValue(x)}`).join(',')
  return String(v)
}

function decodedText(d: Record<string, unknown>) {
  return Object.entries(d)
    .filter(([k]) => k !== 'seq')
    .map(([k, v]) => `${k}=${fmtValue(v)}`)
    .join('  ')
}

export function SignalTrace({ focus }: { focus?: boolean }) {
  const bus = useUi((s) => s.bus)
  const paused = useUi((s) => s.tracePaused)
  const [machine, setMachine] = useState('all')
  const [proto, setProto] = useState('all')
  // the noisy harness turn of the film shows EX1's real bus only, as a person would filter it
  const beat = useUi((s) => s.storyBeat)
  useEffect(() => {
    if (beat === 'tour_noise' || beat === 'tour_streams') {
      setMachine('EX1')
      setProto('ipc')
    } else if (beat.startsWith('tour_') || beat === '') {
      setMachine('all')
      setProto('all')
    }
  }, [beat])
  const machines = useMemo(() => [...new Set(bus.map((b) => b.machine))].sort(), [bus])
  const hasReal = useMemo(() => bus.some((b) => b.source === 'ipc'), [bus])
  const rows = useMemo(() => {
    const out: BusFrame[] = []
    for (let i = bus.length - 1; i >= 0 && out.length < 60; i--) {
      const b = bus[i]
      if (machine !== 'all' && b.machine !== machine) continue
      if (proto === 'ipc' ? b.source !== 'ipc' : proto === 'sim' ? b.source === 'ipc' : proto !== 'all' && (proto === 'sparkplug' ? b.proto !== 'sparkplug' : b.proto === 'sparkplug')) continue
      out.push(b)
    }
    return out
  }, [bus, machine, proto])
  return (
    <Panel id="trace" title="Signal trace" icon="wave" focus={focus}>
      <div className="toolbar">
        <label className="sr-only" htmlFor="tr-m">Filter machine</label>
        <select id="tr-m" className="select" value={machine} onChange={(e) => setMachine(e.target.value)}>
          <option value="all">All machines</option>
          {machines.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <label className="sr-only" htmlFor="tr-p">Protocol</label>
        <select id="tr-p" className="select" value={proto} onChange={(e) => setProto(e.target.value)}>
          <option value="all">J1939 + Sparkplug</option>
          <option value="j1939">J1939</option>
          <option value="sparkplug">Sparkplug B</option>
          {hasReal && <option value="ipc">Real bus, IPC</option>}
          {hasReal && <option value="sim">Simulated only</option>}
        </select>
        <button className="btn sm" onClick={() => useUi.setState({ tracePaused: !paused })} aria-pressed={paused} title="Pause (Space)">
          <Icon name={paused ? 'play' : 'pause'} className="icon" /> {paused ? 'Resume' : 'Pause'}
        </button>
      </div>
      <div className="trace" role="log" aria-live="off" aria-label="Decoded bus frames">
        {rows.length === 0 && <div className="empty">{bus.length ? 'Nothing matches this filter' : 'Waiting for bus frames'}</div>}
        {rows.map((b, i) => {
          const sp = b.proto === 'sparkplug'
          return (
            <div className="trace-row" key={`${b.t}-${b.machine}-${b.ecu}-${i}`}>
              <span className="faint">{b.t.toFixed(3)}</span>
              <span>{b.machine}{b.source === 'ipc' && <em className="ipc-tag" title={`From ${b.node}'s real bus, kept by Abenix`}>IPC</em>}</span>
              <span className={sp ? 'sp' : b.pgn === 65226 ? 'dm1' : 'pgn'}>{sp ? 'SPB' : `${b.pgn}`}</span>
              <span className="name">{b.ecu} · {typeof b.acronym === 'string' ? `${b.acronym} ` : ''}{b.name}</span>
              <span className="dec">{decodedText(b.decoded)}</span>
              {!sp && b.data && <span className="hex">{typeof b.can_id === 'string' ? `${b.can_id}  ` : ''}{hex(b.data)}</span>}
              {sp && b.topic && <span className="hex">{b.topic}</span>}
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

function nodeLabel(n: PlanNode): string {
  if (n.label) return n.label
  const p = (n.params ?? {}) as Record<string, unknown>
  const verb = typeof n.do === 'string' ? n.do.replace(/_/g, ' ') : n.id
  const extra = [p.from ? `from ${p.from}` : '', p.dest ? `to ${p.dest}` : p.to ? `to ${p.to}` : ''].filter(Boolean).join(' ')
  return [n.machine, verb, extra].filter(Boolean).join(' ')
}

function Tree({ n }: { n: PlanNode }) {
  const label = nodeLabel(n)
  const mode = typeof n.mode === 'string' && n.mode !== 'auto' ? n.mode : null
  return (
    <li>
      <span className={`node ${n.status}`} title={`${label}: ${n.status}${mode ? `, ${mode}` : ''}`}>
        <span className="dot" />
        <span>{label}</span>
        {mode && <span className="mono" style={{ fontSize: 9.5, color: '#ffb020', textTransform: 'uppercase' }}>{mode}</span>}
      </span>
      {n.children && n.children.length > 0 && (
        <ul>
          {n.children.map((c) => <Tree key={c.id} n={c} />)}
        </ul>
      )}
    </li>
  )
}

// A rule fired in Abenix, an agent read the machine and answered, a person approved, the PC took it
const STEP_TONE: Record<string, string> = {
  fired: 'warn', running: 'ai', sending: 'ai', waiting: 'warn', answered: 'ok', failed: 'stop', approved: 'ok', denied: 'stop', sent: 'ai', confirmed: 'ok',
  no_command: '', none: '',
}
const STEP_WORD: Record<string, string> = {
  running: 'reading the machine', sending: 'sending', waiting: 'asked a person', answered: 'answered', failed: 'failed', approved: 'approved', denied: 'denied',
  sent: 'sent', confirmed: 'PC took it', no_command: 'no command', none: '',
}

function LoopSpark({ values }: { values?: number[] }) {
  if (!values || values.length < 2) return null
  const lo = Math.min(...values), hi = Math.max(...values)
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${22 - ((v - lo) / (hi - lo || 1)) * 20}`).join(' ')
  return (
    <svg className="loop-spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-label={`Last 15 minutes, ${fmtValue(lo)} to ${fmtValue(hi)}`}>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function ago(t: number | string | undefined, now: number) {
  const ms = typeof t === 'number' ? t : t ? Date.parse(t) : NaN
  if (!Number.isFinite(ms)) return ''
  const s = Math.max(0, Math.round((now - ms) / 1000))
  return s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`
}

// on the site clock, so a recorded take reads the age it had then
function simAgo(t: number) {
  const s = Math.max(0, Math.round((hot.curr?.t ?? t) - t))
  return s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`
}

function LoopCard({ r, web, now }: { r: LoopRecord; web?: string; now: number }) {
  const a = r.action
  const commandWords = a.signal ? `${a.signal} = ${typeof a.value === 'string' ? a.value : JSON.stringify(a.value)}` : ''
  const mid = (r.node || '').replace('ipc-', '').toUpperCase()
  const open = (path: string) => (web ? `${web}${path}` : undefined)
  const t = a.timings || {}
  return (
    <article className={`loop-card ${r.state}`} onClick={() => mid && useUi.setState({ selected: mid })} aria-label={`${r.rule} on ${mid}`}>
      <div className="loop-step">
        <span className="loop-k">Rule</span>
        <span className="loop-t">{r.rule}</span>
        <span className="loop-d">{r.signal ? `${signalName(r.signal)} ${fmtValue(r.value)}` : r.detail}</span>
        <LoopSpark values={r.spark} />
        <span className="loop-at">{typeof (r as { t?: unknown }).t === 'number' && hot.curr ? simAgo((r as unknown as { t: number }).t) : ago(r.fired_at, now)}</span>
      </div>
      <i className={`loop-link ${r.agent.state === 'running' ? 'live' : ''}`} aria-hidden />
      <div className="loop-step">
        <span className="loop-k">Agent</span>
        <span className="loop-t">{prettyAgent(r.agent.name || 'agent')}</span>
        <span className={`chip ${STEP_TONE[r.agent.state] ?? ''}`}>{STEP_WORD[r.agent.state] ?? r.agent.state}</span>
        {r.agent.answer && <span className="loop-d">“{r.agent.answer}”</span>}
        {r.agent.execution_id && open(`/executions/${r.agent.execution_id}`) && (
          <a className="loop-a" href={open(`/executions/${r.agent.execution_id}`)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Run in Abenix ↗</a>
        )}
      </div>
      <i className={`loop-link ${a.state === 'waiting' ? 'live' : ''}`} aria-hidden />
      <div className="loop-step">
        <span className="loop-k">Action</span>
        <span className="loop-t">{commandWords ? `${commandWords} → ${mid}` : a.state === 'no_command' ? 'No command' : 'Not yet'}</span>
        {a.state !== 'none' && <span className={`chip ${STEP_TONE[a.state] ?? ''}`}>{STEP_WORD[a.state] ?? a.state}</span>}
        {a.state === 'waiting' && open(`/approvals`) && (
          <a className="loop-a" href={open('/approvals')} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Approve in Abenix ↗</a>
        )}
        {(a.approved_by || a.decided_by) && <span className="loop-d">by {a.approved_by || a.decided_by}</span>}
        {a.state === 'confirmed' || a.state === 'sent' ? (
          <span className="loop-d mono">{['checks_ms', 'publish_ms', 'confirm_ms'].filter((k) => typeof t[k] === 'number').map((k) => `${k.replace('_ms', '')} ${fmtMs(t[k])}`).join(' · ')}</span>
        ) : null}
      </div>
    </article>
  )
}

export function LoopPanel({ focus }: { focus?: boolean }) {
  useNow(1)
  const loops = useUi((s) => s.loops)
  const web = useUi((s) => s.abenix?.web)
  const hasPc = useUi((s) => !!s.state?.ipc && Object.keys(s.state.ipc).length > 0)
  if (!hasPc && !loops.length) return null
  const now = Date.now()
  return (
    <Panel id="loop" title="Rule → agent → action" icon="loop" focus={focus} extra={loops.length ? <span className="chip">{loops.length}</span> : undefined}>
      <div className="loop-list" role="log" aria-live="polite">
        {loops.length === 0 && (
          <div className="empty">
            No rule has fired yet. The rules live in Abenix{web ? <>: <a href={`${web}/telemetry/rules`} target="_blank" rel="noreferrer">Signal rules ↗</a></> : ''}. Try Pump wear on EX1 on the fault deck.
          </div>
        )}
        {loops.slice(0, 6).map((r) => <LoopCard key={r.id} r={r} web={web} now={now} />)}
      </div>
    </Panel>
  )
}

export function SitePilot({ focus }: { focus?: boolean }) {
  const plan = useUi((s) => s.plan)
  const lines = useUi((s) => s.agentLines)
  const cost = useUi((s) => s.state?.kpi.ai_cost_usd)
  const billing = useUi((s) => s.state?.kpi.ai_billing)
  const ai = useUi((s) => s.aiOffline)
  const recent = lines.slice(-8).reverse()
  return (
    <Panel id="pilot" title="Site Pilot" icon="tree" focus={focus} extra={<span className="chip ai num" title="AI spend this shift, from Abenix">{billing === 'subscription' || (cost === 0 && billing !== 'metered') ? 'AI on subscription' : `AI $${typeof cost === 'number' ? cost.toFixed(2) : '--'}`}</span>}>
      <div className="tree">
        {plan ? <ul><Tree n={plan} /></ul> : <div className="empty">No behaviour tree yet. The Site Superintendent publishes it at shift start.</div>}
      </div>
      <div className="reason" aria-live="polite">
        {ai && <div className="reason-line waiting_approval">AI offline. The site runs the fallback plan and the safety layer is unchanged.</div>}
        {recent.length === 0 && !ai && <div className="empty">Agent reasoning appears here as it streams</div>}
        {recent.map((l, i) => (
          <div key={`${l.t}-${i}`} className={`reason-line ${l.phase}`}>
            <header>
              <b style={{ color: '#c9ecff' }}>{prettyAgent(l.agent)}</b>
              <span className={`chip ${l.phase === 'waiting_approval' ? 'warn' : l.phase === 'answer' ? 'ok' : 'ai'}`}>{l.phase.replace('_', ' ')}</span>
              <span className="num faint" style={{ marginLeft: 'auto' }}>{fmtT(l.t)}</span>
            </header>
            {l.text.replace(/\.\.(\s|$)/g, '.$1')}
          </div>
        ))}
      </div>
    </Panel>
  )
}

const LAYERS = [
  { k: 'l1_ms', n: 'L1', label: 'Twin step', where: 'Abenix code runner', budget: 5 },
  { k: 'l2_ms', n: 'L2', label: 'Safety rules', where: 'Abenix decisions', budget: 1 },
  { k: 'l3_ms', n: 'L3', label: 'Prediction', where: 'Abenix ML', budget: 30 },
  { k: 'l4_ms', n: 'L4', label: 'Pipeline', where: 'Abenix', budget: 300 },
  { k: 'l5_ms', n: 'L5', label: 'Agent', where: 'Abenix', budget: 10000 },
] as const

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <svg className="spark" viewBox="0 0 100 22" preserveAspectRatio="none" aria-hidden><line x1="0" y1="20" x2="100" y2="20" /></svg>
  const lo = Math.min(...values), hi = Math.max(...values)
  const span = hi - lo || hi || 1
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(1)},${(20 - ((v - lo) / span) * 17).toFixed(1)}`).join(' ')
  return (
    <svg className="spark" viewBox="0 0 100 22" preserveAspectRatio="none" aria-hidden>
      <polyline points={`0,22 ${pts} 100,22`} className="fill" />
      <polyline points={pts} />
    </svg>
  )
}

export function LatencyStrip({ focus }: { focus?: boolean }) {
  const lat = useUi((s) => s.state?.latency) as (Record<string, unknown> & Partial<Record<string, number>>) | undefined
  useUi((s) => s.state?.seq)
  return (
    <Panel id="latency" title="Layer latency" icon="gauge" focus={focus} extra={<span className="chip ok" title="Every value is measured by the running system, never set by hand. p50 over the recent window, the line shows each reading">measured</span>}>
      <div className="lat">
        {LAYERS.map((l) => {
          const v = p50(l.k, lat)
          const last = lat?.[l.k]
          const hist = latHistory[l.k].slice(-40)
          return (
            <div key={l.k} className={`lat-cell ${l.n === 'L5' || l.n === 'L4' ? 'slow' : ''}`} title={`${l.n} ${l.label}, computed in ${l.where}. ${hasServerP50(l.k, lat) ? 'p50 from the bff' : `median of the last ${latHistory[l.k].length} readings as the bff reports them`}${typeof last === 'number' ? `, last ${fmtMs(last)}` : ''}`}>
              <div className="lk">{l.n} <span className="faint" style={{ fontWeight: 500, letterSpacing: 0 }}>{hasServerP50(l.k, lat) ? 'p50' : 'median'}</span></div>
              <div className="ln">{l.label}</div>
              <div className="lv">{v !== null ? fmtMs(v) : '--'}</div>
              <Spark values={hist} />
              <div className="ln" style={{ fontSize: 10, marginTop: 3 }}>{l.where}</div>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

export function Autonomy({ focus }: { focus?: boolean }) {
  const agents = useUi((s) => s.agents)
  const err = useUi((s) => s.agentsError)
  const events = useUi((s) => s.events)
  const promoted = useMemo(() => {
    const set = new Set<string>()
    for (const e of events.slice(-20)) if (e.kind === 'autonomy' && typeof e.agent === 'string' && /promot/i.test(e.title)) set.add(e.agent)
    return set
  }, [events])
  const lastPromo = [...events].reverse().find((e) => e.kind === 'autonomy')
  return (
    <Panel id="autonomy" title="Earned Autonomy" icon="ladder" focus={focus} extra={<button className="btn sm" onClick={refreshAgents} title="Reload from Abenix">Refresh</button>}>
      {err && !agents && <div className="err-line">Could not read agents: {err}</div>}
      {!agents && !err && <div><div className="skeleton" /><div className="skeleton" /><div className="skeleton" style={{ width: '60%' }} /></div>}
      {agents && agents.length === 0 && <div className="empty">No gw- agents found. Run scripts/provision.py to load them into Abenix.</div>}
      {lastPromo && <div className="reason-line answer" style={{ marginBottom: 8 }}><b>{lastPromo.title}.</b> {lastPromo.detail}</div>}
      <div className="list">
        {agents?.map((a) => (
          <div key={a.name} className={`agent-row ${promoted.has(a.name) ? 'promoted' : ''}`}>
            <span className="an">{a.label}</span>
            <span className="ladder" aria-label={`Level ${a.levelIndex + 1} of 5, ${LEVEL_NAMES[a.levelIndex]}`}>
              {[0, 1, 2, 3, 4].map((i) => <i key={i} className={i <= a.levelIndex ? 'on' : ''} />)}
            </span>
            <span className="al">
              <span style={{ color: '#c9ecff' }}>{/^\d+$/.test(a.level) ? LEVEL_NAMES[a.levelIndex] : a.level}</span>
              {a.actions.map((x) => <span key={x.type} className="mono faint">{x.type}</span>)}
              {a.record && <span className="faint">{a.record}</span>}
              {a.url && <a href={a.url} target="_blank" rel="noreferrer" style={{ color: '#5cc8ff', pointerEvents: 'auto' }}>Open in Abenix</a>}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  )
}

const FAULTS: { kind: FaultKind; label: string; tone: string; needsTarget?: boolean; confirm?: boolean }[] = [
  { kind: 'worker_in_swing', label: 'Worker into swing zone', tone: 'amber' },
  { kind: 'cut_can', label: 'Cut CAN bus', tone: 'amber', needsTarget: true },
  { kind: 'drop_gnss', label: 'Drop GNSS', tone: 'amber', needsTarget: true },
  { kind: 'gust', label: 'Gust of wind', tone: 'amber' },
  { kind: 'ai_offline', label: 'Pull the AI', tone: 'amber' },
  { kind: 'kill_switch', label: 'Kill switch', tone: 'danger', confirm: true },
  { kind: 'clear', label: 'Clear all faults', tone: 'mint' },
]

const PC_FAULTS = [
  { kind: 'unplug_pc' as FaultKind, label: (id: string) => `Unplug ${id}'s PC`, hint: 'The PC drops off MQTT without a goodbye. Abenix sees its NDEATH, its own safety PLC holds the machine' },
  { kind: 'noisy_harness' as FaultKind, label: (id: string) => `Noisy harness on ${id}`, hint: 'Corrupts frames on the real bus for 6 s: error frames, retransmits, error counters climbing' },
]

// faults that set off a signal rule in Abenix, on the one PC each is for
const LOOP_FAULTS = [
  { kind: 'hydraulic_wear' as FaultKind, id: 'EX1', label: 'Pump wear on EX1', hint: 'The main pump starts losing efficiency: pressure and oil temperature creep up until the rule "EX1 hydraulics running hot" fires' },
  { kind: 'drive_off_road' as FaultKind, id: 'HT1', label: 'Drive HT1 off the road', hint: 'HT1 takes a wrong turn out of its haul area, the rule "HT1 left the haul road" fires' },
]

export function FaultDeck({ focus }: { focus?: boolean }) {
  const pcStr = useUi((s) => (s.state?.ipc ? Object.entries(s.state.ipc).map(([id, p]) => `${id}:${p.online ? 1 : 0}`).join('|') : ''))
  const pcs = useMemo(() => pcStr.split('|').filter(Boolean).map((x) => ({ id: x.split(':')[0], online: x.endsWith(':1') })), [pcStr])
  const idStr = useUi((s) => s.state?.machines.map((m) => m.id).join('|') ?? '')
  const ids = useMemo(() => idStr.split('|').filter(Boolean), [idStr])
  const conn = useUi((s) => s.conn)
  const [target, setTarget] = useState('')
  const [arm, setArm] = useState(false)
  const armTimer = useRef(0)
  const tgt = target || ids.find((i) => /^EX/.test(i)) || ids[0] || ''
  const disabled = conn === 'offline' || conn === 'connecting'
  const fire = (f: (typeof FAULTS)[number]) => {
    if (f.confirm && !arm) {
      setArm(true)
      clearTimeout(armTimer.current)
      armTimer.current = window.setTimeout(() => setArm(false), 3000)
      return
    }
    setArm(false)
    sendFault(f.kind, f.needsTarget || f.kind === 'worker_in_swing' ? tgt : undefined)
  }
  return (
    <Panel id="faults" title="Fault deck" icon="bolt" focus={focus} extra={
      <>
        <label className="sr-only" htmlFor="f-t">Target machine</label>
        <select id="f-t" className="select" value={tgt} onChange={(e) => setTarget(e.target.value)} style={{ minHeight: 26, padding: '2px 6px' }}>
          {ids.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
      </>
    }>
      <div className="faults">
        {FAULTS.map((f) => (
          <button key={f.kind} className={`btn ${f.tone}`} onClick={() => fire(f)} disabled={disabled} title={f.needsTarget ? `Applies to ${tgt}` : undefined}>
            {f.confirm && arm ? 'Click again to confirm' : f.label}
            {f.needsTarget && <span className="mono faint" style={{ marginLeft: 'auto', fontSize: 10 }}>{tgt}</span>}
          </button>
        ))}
      </div>
      {pcs.length > 0 && (
        <>
          <div className="faint" style={{ fontSize: 11, margin: '10px 0 6px' }}>Industrial PCs, through Abenix telemetry</div>
          <div className="faults">
            {pcs.filter((p) => p.id === 'EX1' || p.id === tgt).slice(0, 2).flatMap((p) =>
              PC_FAULTS.map((f) => (
                <button key={f.kind + p.id} className="btn amber" onClick={() => sendFault(f.kind, p.id)} disabled={disabled || !p.online} title={p.online ? f.hint : `${p.id}'s PC is offline`}>
                  {f.label(p.id)}
                  <span className="mono faint" style={{ marginLeft: 'auto', fontSize: 10 }}>IPC</span>
                </button>
              )),
            )}
            {LOOP_FAULTS.filter((f) => pcs.some((p) => p.id === f.id)).map((f) => {
              const on = pcs.find((p) => p.id === f.id)?.online
              return (
                <button key={f.kind} className="btn amber" onClick={() => sendFault(f.kind, f.id)} disabled={disabled || !on} title={on ? f.hint : `${f.id}'s PC is offline`}>
                  {f.label}
                  <span className="mono faint" style={{ marginLeft: 'auto', fontSize: 10 }}>RULE</span>
                </button>
              )
            })}
          </div>
        </>
      )}
      {disabled && <div className="faint" style={{ fontSize: 11, marginTop: 6 }}>Faults need a running simulator.</div>}
    </Panel>
  )
}

const EV_ICON: Record<string, string> = { safety_stop: '#ff4d5e', near_miss: '#ffb020', fault: '#ffb020', gust: '#5cc8ff', plan_change: '#c9ecff', approval: '#3ee6a8', autonomy: '#3ee6a8', story: '#5cc8ff' }

export function Events({ focus }: { focus?: boolean }) {
  const events = useUi((s) => s.events)
  const list = events.slice(-30).reverse()
  return (
    <Panel id="events" title="Events" icon="bell" focus={focus}>
      <div className="events" role="log" aria-live="polite">
        {list.length === 0 && <div className="empty">Quiet so far. Safety stops, faults and plan changes show up here.</div>}
        {list.map((e, i) => (
          <div key={`${e.t}-${i}`} className={`ev ${e.kind}`}>
            <span className="t">{fmtT(e.t)}</span>
            <span className="dot" style={{ color: EV_ICON[e.kind] ?? '#5cc8ff', marginTop: 5 }} />
            <span style={{ minWidth: 0 }}>
              <span className="ti">{e.title}</span>{e.machine ? <span className="mono faint"> {e.machine}</span> : null}
              {e.detail && <div className="de">{e.detail}</div>}
            </span>
            {typeof e.ms === 'number' && <span className="ms">{fmtMs(e.ms)}</span>}
          </div>
        ))}
      </div>
    </Panel>
  )
}

export function PhoneApprovals({ focus, tap }: { focus?: boolean; tap?: boolean }) {
  const approvals = useUi((s) => s.approvals)
  const pending = approvals.filter((a) => a.status === 'pending' || a.status === 'sending')
  return (
    <Panel id="phone" title="Approvals on a phone" icon="phone" focus={focus} extra={pending.length ? <span className="chip warn">{pending.length} waiting</span> : undefined}>
      <div className="phone-wrap">
        <PhoneDevice tap={tap} />
      </div>
      <p className="disclaimer">A mock-up for the video. Real approvals happen in the Abenix approvals page{REPLAY ? '. Replay approvals stay local' : ''}.</p>
    </Panel>
  )
}

export function PhoneDevice({ tap, max = 4 }: { tap?: boolean; max?: number }) {
  const approvals = useUi((s) => s.approvals)
  const pending = approvals.filter((a) => a.status === 'pending' || a.status === 'sending')
  const recent = [...approvals].reverse().slice(0, max)
  // machine commands an agent asked for wait in Abenix too, the phone shows them and who decided
  const asks = useUi((s) => s.loops).filter((r) => r.action?.approval_id && r.action.signal).slice(0, 2)
  const [buzz, setBuzz] = useState(false)
  const lastCount = useRef(0)
  useEffect(() => {
    if (pending.length > lastCount.current) {
      setBuzz(true)
      const id = setTimeout(() => setBuzz(false), 700)
      lastCount.current = pending.length
      return () => clearTimeout(id)
    }
    lastCount.current = pending.length
  }, [pending.length])
  const clock = new Date()
  return (
        <div className={`phone ${buzz ? 'buzz' : ''}`}>
          <div className="phone-notch" />
          <div className="phone-screen">
            <div className="phone-status"><span>{clock.getHours()}:{String(clock.getMinutes()).padStart(2, '0')}</span><span>5G ▮▮▮</span></div>
            <div className="phone-title">Approvals<small>Northgate Yard · site manager</small></div>
            <div className="phone-body">
              {recent.length === 0 && asks.length === 0 && <div className="empty" style={{ marginTop: 40 }}>Nothing waiting for you</div>}
              {asks.map((r) => <CommandCard key={r.id} r={r} />)}
              {recent.slice(0, Math.max(0, max - asks.length)).map((a) => <ApprovalCard key={a.key} a={a} />)}
            </div>
          </div>
          <div className={`thumb ${tap ? 'tap' : ''}`} />
        </div>
  )
}

function CommandCard({ r }: { r: LoopRecord }) {
  const a = r.action
  const mid = (a.node || r.node || '').replace('ipc-', '').toUpperCase()
  const by = a.decided_by || a.approved_by
  return (
    <div className="approval">
      <div className="who"><span>{prettyAgent(r.agent?.name || '')}</span><span className="num">{mid}</span></div>
      <p><b>{a.signal} = {String(a.value)}</b> on {mid}. {a.reason || ''}</p>
      {a.state === 'waiting' && <div className="state" style={{ color: '#ffb020' }}>Waiting for a person in Abenix</div>}
      {['approved', 'sent', 'confirmed'].includes(a.state) && <div className="state" style={{ color: '#3ee6a8' }}>Approved in Abenix{by ? ` by ${by}` : ''}{a.state === 'confirmed' ? `, ${mid}'s PC took it` : ''}</div>}
      {a.state === 'denied' && <div className="state" style={{ color: '#ffb3bb' }}>Rejected in Abenix{by ? ` by ${by}` : ''}</div>}
    </div>
  )
}

function ApprovalCard({ a }: { a: Approval }) {
  return (
    <div className="approval">
      <div className="who"><span>{prettyAgent(a.agent)}</span><span className="num">{fmtT(a.t)}</span></div>
      <p>{a.text.replace(/\.\.(\s|$)/g, '.$1')}</p>
      {a.status === 'pending' && (
        <div className="acts">
          <button className="no" onClick={() => approve(a, 'reject')}>Reject</button>
          <button className="yes" onClick={() => approve(a, 'approve')}>Approve</button>
        </div>
      )}
      {a.status === 'sending' && <div className="state muted">Sending…</div>}
      {a.status === 'approved' && <div className="state" style={{ color: '#3ee6a8' }}>Approved</div>}
      {a.status === 'rejected' && <div className="state" style={{ color: '#ffb3bb' }}>Rejected</div>}
      {a.status === 'error' && (
        <div>
          <div className="state" style={{ color: '#ffb3bb' }}>Not sent: {a.error}</div>
          <button className="btn sm" style={{ marginTop: 6 }} onClick={() => approve(a, 'approve')}>Try again</button>
        </div>
      )}
    </div>
  )
}

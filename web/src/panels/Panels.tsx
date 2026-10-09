import { useEffect, useMemo, useRef, useState } from 'react'
import { useUi, type Approval } from '../live/store'
import { approve, ecuStats, refreshAgents, sendFault } from '../live/client'
import { ECU_NAMES, Icon, Panel, fmtMs, fmtT, modeTone } from '../ui/kit'
import { LEVEL_NAMES, prettyAgent } from '../live/parse'
import type { BusFrame, FaultKind, PlanNode } from '../proto/types'
import { REPLAY } from '../live/config'

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
              <button className="btn sm amber" onClick={() => sendFault('cut_can', machineId)}>Cut CAN on {machineId}</button>
              <button className="btn sm amber" onClick={() => sendFault('drop_gnss', machineId)}>Drop GNSS</button>
            </div>
          )}
        </>
      )}
    </Panel>
  )
}

const hex = (s: string) => s.replace(/(..)/g, '$1 ').trim().toUpperCase()

function decodedText(d: Record<string, unknown>) {
  return Object.entries(d)
    .filter(([k]) => k !== 'seq')
    .map(([k, v]) => `${k}=${typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(2)) : String(v)}`)
    .join('  ')
}

export function SignalTrace({ focus }: { focus?: boolean }) {
  const bus = useUi((s) => s.bus)
  const paused = useUi((s) => s.tracePaused)
  const [machine, setMachine] = useState('all')
  const [proto, setProto] = useState('all')
  const machines = useMemo(() => [...new Set(bus.map((b) => b.machine))].sort(), [bus])
  const rows = useMemo(() => {
    const out: BusFrame[] = []
    for (let i = bus.length - 1; i >= 0 && out.length < 60; i--) {
      const b = bus[i]
      if (machine !== 'all' && b.machine !== machine) continue
      if (proto !== 'all' && (proto === 'sparkplug' ? b.proto !== 'sparkplug' : b.proto === 'sparkplug')) continue
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
              <span>{b.machine}</span>
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

export function SitePilot({ focus }: { focus?: boolean }) {
  const plan = useUi((s) => s.plan)
  const lines = useUi((s) => s.agentLines)
  const cost = useUi((s) => s.state?.kpi.ai_cost_usd)
  const ai = useUi((s) => s.aiOffline)
  const recent = lines.slice(-8).reverse()
  return (
    <Panel id="pilot" title="Site Pilot" icon="tree" focus={focus} extra={<span className="chip ai num" title="AI spend this shift, from Abenix">AI ${typeof cost === 'number' ? cost.toFixed(2) : '--'}</span>}>
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
            {l.text}
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

export function LatencyStrip({ focus }: { focus?: boolean }) {
  const lat = useUi((s) => s.state?.latency)
  const scale = (ms: number) => Math.max(3, Math.min(100, ((Math.log10(Math.max(0.05, ms)) + 1.3) / 5.4) * 100))
  return (
    <Panel id="latency" title="Layer latency, measured" icon="gauge" focus={focus} extra={<span className="chip ok" title="Every value is measured by the running system, never set by hand">measured</span>}>
      <div className="lat">
        {LAYERS.map((l) => {
          const v = lat?.[l.k]
          return (
            <div key={l.k} className={`lat-cell ${l.n === 'L5' || l.n === 'L4' ? 'slow' : ''}`} title={`${l.n} ${l.label}, computed in ${l.where}`}>
              <div className="lk">{l.n}</div>
              <div className="ln">{l.label}</div>
              <div className="lv">{v !== undefined && v !== null ? fmtMs(v) : '--'}</div>
              <div className="lat-bar"><i style={{ width: `${v ? scale(v) : 0}%` }} /></div>
              <div className="ln" style={{ fontSize: 10, marginTop: 4 }}>{l.where}</div>
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
    for (const e of events.slice(-20)) if (e.kind === 'autonomy' && typeof e.agent === 'string') set.add(e.agent)
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

export function FaultDeck({ focus }: { focus?: boolean }) {
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
  const recent = [...approvals].reverse().slice(0, 4)
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
    <Panel id="phone" title="Approvals on a phone" icon="phone" focus={focus} extra={pending.length ? <span className="chip warn">{pending.length} waiting</span> : undefined}>
      <div className="phone-wrap">
        <div className={`phone ${buzz ? 'buzz' : ''}`}>
          <div className="phone-notch" />
          <div className="phone-screen">
            <div className="phone-status"><span>{clock.getHours()}:{String(clock.getMinutes()).padStart(2, '0')}</span><span>5G ▮▮▮</span></div>
            <div className="phone-title">Approvals<small>Northgate Yard · site manager</small></div>
            <div className="phone-body">
              {recent.length === 0 && <div className="empty" style={{ marginTop: 40 }}>Nothing waiting for you</div>}
              {recent.map((a) => <ApprovalCard key={a.key} a={a} />)}
            </div>
          </div>
          <div className={`thumb ${tap ? 'tap' : ''}`} />
        </div>
      </div>
      <p className="disclaimer">A mock-up for the video. Real approvals happen in the Abenix approvals page{REPLAY ? '. Replay approvals stay local' : ''}.</p>
    </Panel>
  )
}

function ApprovalCard({ a }: { a: Approval }) {
  return (
    <div className="approval">
      <div className="who"><span>{prettyAgent(a.agent)}</span><span className="num">{fmtT(a.t)}</span></div>
      <p>{a.text}</p>
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

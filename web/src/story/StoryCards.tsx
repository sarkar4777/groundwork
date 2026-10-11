import { useEffect, useRef, useState } from 'react'
import { useUi } from '../live/store'
import { p50 } from '../live/latency'
import { PhoneDevice } from '../panels/Panels'
import { LEVEL_NAMES, prettyAgent } from '../live/parse'
import { fmtMs } from '../ui/kit'

// Large, single-purpose cards for the story video, sized in vmin so they read on a phone.

export function StoryPhone({ tap }: { tap: boolean }) {
  return (
    <div className="sc-phone">
      <div className="sc-kicker">Approval on the site manager's phone</div>
      <PhoneDevice tap={tap} max={2} />
    </div>
  )
}

const LAT = [
  ['l1_ms', 'L1', 'Twin step'],
  ['l2_ms', 'L2', 'Safety rules'],
  ['l3_ms', 'L3', 'Prediction'],
  ['l4_ms', 'L4', 'Pipeline'],
  ['l5_ms', 'L5', 'Agent'],
] as const

export function StoryLatency() {
  const lat = useUi((s) => s.state?.latency) as Record<string, unknown> | undefined
  return (
    <div className="sc-card sc-lat">
      <div className="sc-kicker">Every layer, measured in Abenix · p50</div>
      <div className="sc-lat-row">
        {LAT.map(([k, n, label]) => {
          const v = p50(k, lat)
          return (
            <div key={k} className={`sc-lat-cell ${n === 'L4' || n === 'L5' ? 'slow' : ''}`}>
              <span className="n">{n}</span>
              <span className="v">{v !== null ? fmtMs(v) : '--'}</span>
              <span className="l">{label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Dial({ value, max, label, unit, tone }: { value: number; max: number; label: string; unit: string; tone: string }) {
  const a0 = -210, a1 = 30
  const ang = (v: number) => ((a0 + (Math.min(max, Math.max(0, v)) / max) * (a1 - a0)) * Math.PI) / 180
  const arc = (from: number, to: number, r: number) => {
    const p = (a: number) => [60 + Math.cos(a) * r, 60 + Math.sin(a) * r]
    const [x0, y0] = p(from), [x1, y1] = p(to)
    return `M${x0} ${y0} A${r} ${r} 0 ${to - from > Math.PI ? 1 : 0} 1 ${x1} ${y1}`
  }
  return (
    <svg viewBox="0 0 120 100" className="sc-dial" role="img" aria-label={`${label} ${value.toFixed(1)} ${unit}`}>
      <path d={arc(ang(0), ang(max), 46)} stroke="rgba(201,236,255,0.18)" strokeWidth="8" fill="none" strokeLinecap="round" />
      <path d={arc(ang(0), ang(value), 46)} stroke={tone} strokeWidth="8" fill="none" strokeLinecap="round" />
      <text x="60" y="64" textAnchor="middle" fontSize="24" fontWeight="700" fill="#fff" fontFamily="JetBrains Mono">{value.toFixed(1)}</text>
      <text x="60" y="82" textAnchor="middle" fontSize="9" fill="rgba(201,236,255,0.8)" fontFamily="JetBrains Mono">{label} {unit}</text>
    </svg>
  )
}

export function StoryGust() {
  const st = useUi((s) => s.state)
  const tc = st?.cranes?.find((c) => /^TC/i.test(c.id))
  const tcM = st?.machines.find((m) => m.id === tc?.id)
  const wind = tc?.wind_ms ?? st?.sensors.wind_ms ?? 0
  const gust = st?.sensors.gust_ms ?? wind
  const held = !!tcM && (tcM.mode === 'hold' || st?.safety.active_stops.some((s) => s.machine === tcM.id))
  const tone = held ? '#ff4d5e' : wind > 9 ? '#ffb020' : '#3ee6a8'
  return (
    <>
      <div className="sc-streaks" style={{ opacity: Math.min(0.85, Math.max(0, (gust - 4) / 8)) }} aria-hidden />
      <div className="sc-card sc-gust">
        <div className="sc-kicker">Gust at the tower crane</div>
        <div className="sc-gust-row">
          <Dial value={wind} max={20} label="WIND" unit="m/s" tone={tone} />
          <div className="sc-gust-side">
            <div className={`sc-state ${held ? 'stop' : 'ok'}`}>{held ? `${tc?.id} HOLDS` : `${tc?.id ?? 'TC1'} LIFTING`}</div>
            <div className="sc-sub">Gust peak {gust.toFixed(1)} m/s</div>
            {tc && <div className="sc-sub">Hook load {tc.load_t.toFixed(1)} t · LMI {tc.lmi_pct.toFixed(0)}%</div>}
          </div>
        </div>
      </div>
    </>
  )
}

export function StoryAiOff() {
  const off = useUi((s) => s.aiOffline)
  const lat = useUi((s) => s.state?.latency) as Record<string, unknown> | undefined
  const seq = useUi((s) => s.state?.seq ?? 0)
  const stops = useUi((s) => s.state?.safety.active_stops.length ?? 0)
  const agents = useUi((s) => s.agents)
  const l1 = p50('l1_ms', lat), l2 = p50('l2_ms', lat)
  return (
    <>
      <div className={`sc-pill ${off ? 'off' : 'on'}`}>
        <span className="dot" />
        {off ? 'AI OFFLINE · SITE SAFE' : 'AI ONLINE'}
      </div>
      <div className="sc-card sc-aioff">
        <div className="sc-kicker">Safety keeps running</div>
        <div className="sc-big-row">
          <div><span className="v">{l1 !== null ? fmtMs(l1) : '--'}</span><span className="l">twin step</span></div>
          <div><span className="v">{l2 !== null ? fmtMs(l2) : '--'}</span><span className="l">safety rules</span></div>
          <div><span className="v num">{seq.toLocaleString('en-GB')}</span><span className="l">twin steps</span></div>
        </div>
        <div className="sc-lanes">
          {(agents ?? []).slice(0, 4).map((a) => (
            <div key={a.name} className={`sc-lane ${off ? 'paused' : ''}`}>
              <span>{a.label}</span>
              <em>{off ? 'paused' : 'running'}</em>
            </div>
          ))}
        </div>
        {stops > 0 && <div className="sc-sub">{stops} safety stop{stops > 1 ? 's' : ''} still enforced</div>}
      </div>
    </>
  )
}

export function StoryCode() {
  const lines = useUi((s) => s.agentLines)
  const builder = lines.filter((l) => /vecu/i.test(l.agent))
  const answer = [...builder].reverse().find((l) => typeof l.source === 'string')
  const source = typeof answer?.source === 'string' ? answer.source : ''
  const tests = answer?.text.match(/(\d+) of (\d+) golden tests/)
  const [shown, setShown] = useState(0)
  const startedAt = useRef(0)
  useEffect(() => {
    if (!source) return
    startedAt.current = performance.now()
    const id = setInterval(() => setShown(Math.floor((performance.now() - startedAt.current) / 32)), 50)
    return () => clearInterval(id)
  }, [source])
  const code = source.split('\n').filter((l) => l.trim() !== '')
  const visible = code.slice(0, Math.min(code.length, shown)).slice(-14)
  const done = source && shown >= code.length + 4
  return (
    <div className="sc-card sc-code">
      <div className="sc-kicker">{prettyAgent(answer?.agent ?? builder[0]?.agent ?? 'gw-vecu-builder')} writes the TH1 controller</div>
      <pre>
        {source ? visible.map((l, i) => <div key={i}>{l}</div>) : builder.slice(-2).map((l, i) => <div key={i} className="dim">{l.text}</div>)}
        {!done && <span className="caret" />}
      </pre>
      {done && tests && (
        <div className="sc-tests">
          <span className="tick">✓</span> Golden tests {tests[1]}/{tests[2]} passed
        </div>
      )}
    </div>
  )
}

const PICK = ['gw-fleet-dispatcher', 'gw-site-superintendent', 'gw-crane-coordinator']

export function StoryAutonomy() {
  const agents = useUi((s) => s.agents)
  const [grown, setGrown] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setGrown(true), 300)
    return () => clearTimeout(id)
  }, [])
  const list = PICK.map((n) => agents?.find((a) => a.name === n)).filter(Boolean)
  return (
    <div className="sc-card sc-auto">
      <div className="sc-kicker">Earned Autonomy, from each agent's record in Abenix</div>
      {list.map((a) => {
        const reviews = Number(a!.record?.match(/(\d+) reviews/)?.[1] ?? 0)
        const pct = Math.min(100, (reviews / 20) * 100)
        return (
          <div key={a!.name} className="sc-agent">
            <div className="top">
              <span className="name">{a!.label}</span>
              <span className="lvl">{/^\d+$/.test(a!.level) ? LEVEL_NAMES[a!.levelIndex] : a!.level}</span>
            </div>
            <div className="ladder">
              {LEVEL_NAMES.map((n, i) => <i key={n} className={i <= a!.levelIndex ? 'on' : ''} title={n} />)}
            </div>
            <div className="trust"><i style={{ width: grown ? `${Math.max(2, pct)}%` : '0%' }} /></div>
            <div className="sc-sub">{reviews} of 20 reviews toward the next level</div>
          </div>
        )
      })}
    </div>
  )
}

export const TITLE = 'Groundwork'
export const SUBTITLE = 'An autonomous construction site, run by Abenix'
export const ECOSYSTEM = 'A real-time agentic ecosystem, worked out end to end on Abenix, driven by simulated live streams from machine buses, telematics, GNSS and weather.'

// The film's opening: the whole ground station live behind the same title as the end card.
export function OpeningTitle() {
  return (
    <div className="sc-open">
      <div className="band">
        <h1>{TITLE}</h1>
        <p>{SUBTITLE}</p>
        <div className="line2">{ECOSYSTEM}</div>
        <RealLine />
      </div>
    </div>
  )
}

export function StoryEnd({ show }: { show: boolean }) {
  if (!show) return null
  const repo = (import.meta.env.VITE_REPO_URL as string | undefined) || 'github.com/sarkar4777/groundwork'
  return (
    <div className="sc-end">
      <div className="band">
        <h1>{TITLE}</h1>
        <p>{SUBTITLE}</p>
        <div className="line2">{ECOSYSTEM}</div>
      </div>
      <div className="credits">
        <span>Built on Abenix · open source, MIT</span>
        <RealLine />
        <span className="mono">{repo}</span>
      </div>
    </div>
  )
}

// On real ground the film says what is a photograph and what is the twin.
function RealLine() {
  const rg = useUi((s) => s.realGround)
  if (!rg) return null
  return <span className="real-line">Real drone orthophoto: {rg.attribution}. Machines, people and every number simulated by the twin in Abenix.</span>
}

export function RealCredit() {
  const rg = useUi((s) => s.realGround)
  if (!rg) return null
  return (
    <div className="real-credit" aria-label="Imagery credit">
      <b>REAL</b> drone orthophoto, {rg.attribution} · <b className="sim">SIMULATED</b> machines and people
    </div>
  )
}

// The industrial PC's loop, every hop on the clock that measured it
export function StoryHops() {
  const pc = useUi((s) => s.state?.ipc?.EX1)
  const v = useUi((s) => s.state?.latency?.ipc)
  const tick = useUi((s) => (s.state?.latency as { l2_tick_ms?: number } | undefined)?.l2_tick_ms)
  if (!pc || !v) return null
  const L = pc.lat || {}
  const stop = v.last_stop && v.last_stop.machine === 'EX1' ? v.last_stop : null
  const hop = (name: string) => stop?.hops.find((h) => h.hop === name || h.hop.startsWith(name + ','))?.ms
  const split = stop ? stop.hops.some((h) => h.hop === 'Abenix checks') : v.checks_p50_ms != null
  const noisy = (pc.noise ?? 0) > 0 || pc.ecus_passive > 0 || (!!pc.bus_state && pc.bus_state !== 'error-active')
  const up: [string, number | null | undefined, string][] = [
    ['ECU to the wire', L.BusQueue_ms, 'J1939 queue, p50'],
    ['Wire to gateway', L.BusToGateway_ms, 'on the PC, p50'],
    ['Gateway to Abenix store', v.publish_to_store_p50_ms, 'Sparkplug over MQTT, p50'],
  ]
  const down: [string, number | null | undefined, string][] = [
    ['Twin decides', hop('Twin decides') ?? tick, 'safety rules in Abenix'],
    ['bff to Abenix', hop('bff to Abenix') ?? v.bff_to_abenix_ms, 'half a round trip'],
    ...(split
      ? ([
          ['Abenix checks', hop('Abenix checks') ?? v.checks_p50_ms, 'access, limits, encode'],
          ['Publish to the PC', hop('Abenix publish to the PC') ?? L.SiteToGateway_ms, 'MQTT broker to the gateway'],
        ] as [string, number | null | undefined, string][])
      : ([['Abenix to the PC', hop('Abenix to the PC') ?? L.SiteToGateway_ms, 'checks, MQTT']] as [string, number | null | undefined, string][])),
    stop && !stop.moving ? ['Hold in force', hop('Hold in force') ?? null, 'ACK on the bus, EX1 was already still'] : ['Machine still', hop('PC to standstill') ?? L.HoldStop_ms, `ACK on the bus at ${fmtMs(stop?.hold_ack_ms ?? L.HoldAck_ms)}`],
  ]
  const row = (dir: string, items: typeof up) => (
    <div className="sc-hops-row">
      <span className="dir">{dir}</span>
      {items.map(([l, ms, n]) => (
        <div key={l} className="sc-hop">
          <span className="v">{ms == null ? '--' : fmtMs(ms)}</span>
          <span className="l">{l}</span>
          <span className="n">{n}</span>
        </div>
      ))}
    </div>
  )
  return (
    <div className="sc-card sc-hops">
      <div className="sc-kicker">EX1 · {pc.node} · IPC, real J1939 bus · every hop measured</div>
      {row('UP', up)}
      {row('DOWN', down)}
      <div className="sc-hops-total">
        {noisy ? <span className="noise">Noisy harness: {pc.error_frames ?? 0} error frames · TEC up to {pc.tec_max ?? 0} · {pc.ecus_passive} ECUs error-passive · bus {pc.bus_state}</span>
          : stop ? <span>{stop.moving ? 'Hazard to standstill' : 'Hazard to hold in force'} <b>{fmtMs(stop.stop_ms)}</b> · seen back in Abenix after <b>{fmtMs(stop.confirm_ms ?? undefined)}</b></span>
          : <span>Bus {pc.bus_load_pct?.toFixed(1) ?? '--'}% · {pc.fps ?? '--'} frames/s · {pc.uplink_mps ?? '--'} Sparkplug messages/s</span>}
      </div>
    </div>
  )
}

// EX1's PC through the unplug: what Abenix sees and what the machine does
export function StoryPc() {
  const pc = useUi((s) => s.state?.ipc?.EX1)
  const events = useUi((s) => s.events)
  if (!pc) return null
  const last = [...events].reverse().find((e) => e.machine === 'EX1' && /PC/.test(e.title))
  return (
    <div className={`sc-card sc-pc ${pc.online ? 'on' : 'off'}`}>
      <div className="sc-kicker">EX1's industrial PC · {pc.node}</div>
      <div className="sc-pc-state">{pc.online ? 'ONLINE' : 'OFFLINE'}</div>
      <dl>
        <dt>On the broker</dt><dd>{pc.online ? 'NBIRTH, live in Abenix' : 'NDEATH, its last will'}</dd>
        <dt>Safety PLC</dt><dd>{pc.holding || !pc.online ? 'holding the machine' : pc.mode || 'auto'}</dd>
        <dt>Bus</dt><dd>{pc.online ? `${pc.bus_load_pct?.toFixed(1) ?? '--'}% · ${pc.fps ?? '--'} frames/s` : 'still running on the machine'}</dd>
        <dt>Uplink</dt><dd>{pc.online ? `${pc.uplink_mps ?? '--'} messages/s` : 'none'}</dd>
      </dl>
      {last && <div className="sc-pc-ev">{last.title}</div>}
    </div>
  )
}

// EX1's oil and pump while the wear builds
export function StoryOil() {
  const pc = useUi((s) => s.state?.ipc?.EX1)
  if (!pc) return null
  return (
    <div className="sc-card sc-oil">
      <div className="sc-kicker">EX1 · hydraulics · real bus, through Abenix</div>
      <div className="sc-oil-row">
        <div><span className="v">{pc.oil_c != null ? `${pc.oil_c.toFixed(1)} °C` : '--'}</span><span className="l">Oil temperature</span></div>
        <div><span className="v">{pc.pump1_bar != null ? `${Math.round(pc.pump1_bar)} bar` : '--'}</span><span className="l">Pump 1 pressure</span></div>
      </div>
      <div className="sc-oil-note">Signal rule in Abenix: fires when the last 5 minutes run 15% above the half hour before</div>
    </div>
  )
}

// the rule, the agent and the action, large
export function StoryLoop() {
  const r = useUi((s) => s.loops.find((x) => x.node === 'ipc-ex1'))
  if (!r) return null
  const a = r.action
  const word: Record<string, string> = { waiting: 'waiting for a person', approved: 'approved', sent: 'sent', confirmed: 'PC took it', no_command: 'no command', denied: 'denied' }
  return (
    <div className="sc-card sc-loop">
      <div className="sc-kicker">Rule → agent → action, live from Abenix</div>
      <div className="sc-loop-row">
        <div className="sc-loop-step on"><span className="k">Rule fired</span><span className="t">{r.rule}</span><span className="d">{r.detail}</span></div>
        <div className={`sc-loop-step ${r.agent.state !== 'running' ? 'on' : 'live'}`}><span className="k">Maintenance tech</span><span className="t">{r.agent.state === 'running' ? 'reading the history and the manual' : r.agent.state}</span>{r.agent.answer && <span className="d">“{r.agent.answer}”</span>}</div>
        <div className={`sc-loop-step ${a.state === 'confirmed' ? 'on' : a.state === 'waiting' ? 'live' : ''}`}><span className="k">Action</span><span className="t">{a.signal ? `${a.signal} = ${String(a.value)} → EX1` : 'not yet'}</span><span className="d">{word[a.state] ?? ''}{a.decided_by || a.approved_by ? `, by ${a.decided_by || a.approved_by}` : ''}{a.timings && typeof a.timings.confirm_ms === 'number' ? `, confirmed in ${fmtMs(a.timings.confirm_ms)}` : ''}</span></div>
      </div>
    </div>
  )
}

// the clock, and how fast the film plays it
export function StoryLapse({ s }: { s: number }) {
  const t0 = useUi((st) => st.story.t0)
  const wear = useUi((st) => st.story.steps?.wear)
  const k = (window as unknown as { __gwLapse?: number }).__gwLapse ?? 1
  const since = wear !== undefined ? Math.max(0, s - (wear - t0)) : 0
  const mm = Math.floor(since / 60), ss = Math.floor(since % 60)
  return (
    <div className={`sc-lapse ${k > 1 ? 'fast' : ''}`} aria-live="off">
      <span className="speed">{k > 1 ? `×${k} TIME-LAPSE` : 'REAL TIME'}</span>
      <span className="clock">+{mm}:{String(ss).padStart(2, '0')} since the pump started to wear</span>
    </div>
  )
}

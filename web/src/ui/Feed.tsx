import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { setCam, useUi, type CamMode, type Overlays } from '../live/store'
import { hot } from '../live/hot'
import { labelEls } from '../scene/Labels'
import { CabHud, DroneHud, ModeTag, NervousHud, SeatHud } from '../hud/Hud'
import { Icon, fmtMs } from './kit'
import { REPLAY } from '../live/config'
import { Captions, StoryLayer } from '../story/StoryLayer'
import { MachineCard } from './MachineCard'
import { Boundary } from './Boundary'

const Scene = lazy(() => import('../scene/Scene').then((m) => ({ default: m.Scene })))

export const MODES: { id: CamMode; label: string; key: string }[] = [
  { id: 'drone', label: 'Drone feed', key: '1' },
  { id: 'orbit', label: '3D twin', key: '2' },
  { id: 'follow', label: 'Follow', key: '3' },
  { id: 'cab', label: 'Crane cab', key: '4' },
  { id: 'seat', label: 'Operator seat', key: '5' },
  { id: 'nervous', label: 'Nervous system', key: 'X' },
]

const LAYERS: { id: keyof Overlays; label: string }[] = [
  { id: 'geofence', label: 'Geofences and exclusion zones' },
  { id: 'swing', label: 'Excavator swing radius' },
  { id: 'crane', label: 'Crane slew envelopes' },
  { id: 'roads', label: 'Haul roads and truck ETAs' },
  { id: 'cutfill', label: 'Cut and fill against design' },
  { id: 'workers', label: 'Worker tags' },
  { id: 'labels', label: 'Machine labels' },
]

const reg = (key: string) => (el: HTMLElement | null) => {
  if (el) labelEls.set(key, el)
  else labelEls.delete(key)
}

function truckEta(m: { x: number; y: number; heading: number; speed: number }): string | null {
  const site = hot.site
  if (!site || m.speed < 0.4) return null
  let best: { d: number; rem: number } | null = null
  for (const r of site.haulRoads) {
    const pts = r.points
    let acc = 0
    const cum = [0]
    for (let i = 1; i < pts.length; i++) cum.push((acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])))
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i]
      const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy || 1
      const t = Math.max(0, Math.min(1, ((m.x - ax) * vx + (m.y - ay) * vy) / L2))
      const d = Math.hypot(m.x - ax - vx * t, m.y - ay - vy * t)
      if (d > 8 || (best && d >= best.d)) continue
      const s = cum[i - 1] + Math.sqrt(L2) * t
      const fwd = Math.cos(m.heading) * vx + Math.sin(m.heading) * vy >= 0
      best = { d, rem: fwd ? acc - s : s }
    }
  }
  if (!best) return null
  const sec = best.rem / m.speed
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`
}

function LabelLayer() {
  const st = useUi((s) => s.state)
  const ov = useUi((s) => s.overlays)
  const cam = useUi((s) => s.cam)
  const sel = useUi((s) => s.selected)
  const events = useUi((s) => s.events)
  const stops = st?.safety.active_stops ?? []
  const stopMs = (id: string) => {
    for (let i = events.length - 1; i >= 0; i--) if (events[i].kind === 'safety_stop' && events[i].machine === id) return events[i].ms
    return undefined
  }
  const nerv = cam === 'nervous'
  const showM = ov.labels && !nerv && cam !== 'seat' && cam !== 'cab'
  return (
    <div className="labels" aria-hidden>
      {showM &&
        st?.machines.map((m) => {
          const eta = /truck|haul/i.test(m.kind) && ov.roads ? truckEta(m) : null
          const air = /drone/i.test(m.kind)
          return (
            <div key={m.id} className="lbl" ref={reg('m:' + m.id)}>
              <div>
                <span className={`mlabel ${sel === m.id ? 'sel' : ''}`} onClick={() => useUi.setState({ selected: m.id })} style={{ pointerEvents: 'auto' }} title={`${m.id} ${m.task}`}>
                  {m.id}
                  <span className={`md ${m.health === 'fault' ? 'fault' : m.mode}`}>{m.health === 'fault' ? 'FAULT' : m.mode.toUpperCase()}</span>
                  {eta && <span style={{ color: '#c9ecff' }}>ETA {eta}</span>}
                </span>
                {(sel === m.id || (!air && /excav|crane|pil|tele/i.test(m.kind))) && m.task && <span className="mtask">{m.task}</span>}
              </div>
            </div>
          )
        })}
      {ov.workers && !nerv &&
        st?.workers.map((w) => (
          <div key={w.id} className="lbl" ref={reg('w:' + w.id)}>
            <div>
              <span className={`wtag ${w.zone}`}>
                {w.id} <em>{w.role}</em>
              </span>
            </div>
          </div>
        ))}
      {!nerv &&
        stops.map((s) => (
          <div key={'stop' + s.machine} className="lbl" ref={reg('stop:' + s.machine)}>
            <div style={{ marginTop: -54 }}>
              <span className="stoplabel">Safety stop {stopMs(s.machine) !== undefined ? fmtMs(stopMs(s.machine)) : `· ${s.rule.replace(/_/g, ' ')}`}</span>
            </div>
          </div>
        ))}
      {nerv && (
        <>
          <div className="lbl" ref={reg('core')}>
            <div>
              <span className="corelabel">ABENIX<small>agents, pipelines, decisions, ML</small></span>
            </div>
          </div>
          <div className="lbl" ref={reg('safety')}>
            <div>
              <span className="corelabel" style={{ fontSize: 11, letterSpacing: '0.2em' }}>SAFETY LAYER<small>rules on every tick</small></span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function ModeBar() {
  const cam = useUi((s) => s.cam)
  return (
    <nav className="modebar glass" aria-label="Camera mode">
      {MODES.map((m) => (
        <button key={m.id} aria-pressed={cam === m.id} onClick={() => setCam(m.id)} title={`${m.label} (${m.key})`}>
          {m.label} <kbd>{m.key}</kbd>
        </button>
      ))}
    </nav>
  )
}

function LayerMenu() {
  const [open, setOpen] = useState(false)
  const ov = useUi((s) => s.overlays)
  useEffect(() => {
    const close = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [])
  return (
    <div className="layers">
      <button className="btn glass" aria-expanded={open} aria-controls="layers-menu" onClick={() => setOpen((o) => !o)} title="Survey overlays (O)">
        <Icon name="layers" /> Overlays
      </button>
      {open && (
        <div className="layers-menu glass" id="layers-menu" role="group" aria-label="Survey overlays">
          {LAYERS.map((l) => (
            <label key={l.id}>
              <input type="checkbox" checked={ov[l.id]} onChange={(e) => useUi.setState((s) => ({ overlays: { ...s.overlays, [l.id]: e.target.checked } }))} />
              {l.label}
            </label>
          ))}
          {ov.cutfill && (
            <div className="legend" style={{ padding: '4px 6px' }}>
              <span><i className="swatch" style={{ background: '#3ca0ff' }} />cut left</span>
              <span><i className="swatch" style={{ background: '#3ee6a8' }} />at design</span>
              <span><i className="swatch" style={{ background: '#ffb020' }} />fill placed</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Banners() {
  const ai = useUi((s) => s.aiOffline)
  const killed = useUi((s) => s.killed)
  const env = useUi((s) => s.state?.safety.envelope)
  if (killed)
    return (
      <div className="banner kill" role="status">
        <span className="dot" style={{ color: '#ff4d5e' }} /> Kill switch engaged. Agents stopped, machines on rules and fallback.
      </div>
    )
  if (ai)
    return (
      <div className="banner ai" role="status">
        <span className="dot" style={{ color: '#3ee6a8' }} /> AI offline, site safe <b>{env === 'stop' ? 'safety stop active' : 'fallback plan running'}</b>
      </div>
    )
  return null
}

function OfflineCard() {
  const conn = useUi((s) => s.conn)
  const has = useUi((s) => !!s.state)
  const err = useUi((s) => s.connError)
  if (has && conn !== 'offline') return null
  if (has && conn === 'offline')
    return (
      <div className="banner kill" role="status" style={{ top: 100 }}>
        <span className="dot" style={{ color: '#ff4d5e' }} /> Lost the simulator. Reconnecting, the view is frozen at the last frame.
      </div>
    )
  return (
    <div className="offline-card" role="status">
      <div className="card glass">
        {conn === 'offline' ? <Icon name="bolt" className="icon" /> : <div className="spinner" />}
        <h3>{conn === 'offline' ? 'Simulator offline' : 'Connecting to Northgate Yard'}</h3>
        {conn === 'offline' ? (
          <>
            <p>Start it with <code>scripts/dev.sh</code>, then this view connects by itself.</p>
            <p className="faint" style={{ fontSize: 12 }}>Retrying ws://localhost:8710/ws {err ? `(${err})` : ''}</p>
            <p className="faint" style={{ fontSize: 12 }}>For a design preview without the simulator, open <code>?replay=1</code>. Replay frames are synthesised and labelled.</p>
          </>
        ) : (
          <p>Waiting for the first twin frame.</p>
        )}
      </div>
    </div>
  )
}

function SceneFallback() {
  return (
    <div className="offline-card" style={{ background: 'transparent' }}>
      <div style={{ textAlign: 'center' }}>
        <div className="spinner" />
        <p className="muted" style={{ marginTop: 10 }}>Loading the site</p>
      </div>
    </div>
  )
}

export function Feed() {
  const cam = useUi((s) => s.cam)
  const story = useUi((s) => s.story.running)
  const hud = useMemo(() => {
    switch (cam) {
      case 'drone':
        return <DroneHud />
      case 'cab':
        return <CabHud />
      case 'seat':
        return <SeatHud />
      case 'nervous':
        return <NervousHud />
      case 'follow':
        return <ModeTag label="FOLLOW" sub="click a machine to follow it" />
      default:
        return <ModeTag label="3D TWIN" sub="drag to orbit, scroll to zoom" />
    }
  }, [cam])
  return (
    <main className="feed" aria-label="Site view">
      <Boundary label="The 3D view">
        <Suspense fallback={<SceneFallback />}>
          <Scene />
        </Suspense>
      </Boundary>
      {!location.search.includes('nolabels') && <LabelLayer />}
      {hud}
      {REPLAY && <div className="replay-mark">REPLAY · SYNTHESISED FRAMES, NOT FROM ABENIX</div>}
      <Banners />
      {!story && <MachineCard />}
      {!story && <ModeBar />}
      {!story && <LayerMenu />}
      <Captions />
      <StoryLayer />
      <OfflineCard />
    </main>
  )
}


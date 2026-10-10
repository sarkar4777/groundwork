import { Fragment, useEffect } from 'react'
import { setCam, useUi } from './live/store'
import type { Kpi } from './proto/types'
import { startStory, stopStory } from './live/client'
import { REPLAY, CAPTURE } from './live/config'
import { Feed, MODES } from './ui/Feed'
import { Icon } from './ui/kit'
import { Autonomy, Events, FaultDeck, LatencyStrip, PhoneApprovals, SignalTrace, SitePilot, VecuConsole } from './panels/Panels'
import { downloadSrt } from './story/StoryLayer'

// A Claude subscription serves the agent runs, so a zero cost is a billing mode, not a broken meter.
function aiCost(k: Kpi | undefined): string {
  if (!k) return '--'
  if (k.ai_billing === 'subscription') return 'subscription'
  if (typeof k.ai_cost_usd !== 'number') return '--'
  return k.ai_cost_usd === 0 && k.ai_billing !== 'metered' ? 'subscription' : `$${k.ai_cost_usd.toFixed(2)}`
}

function Kpis() {
  const k = useUi((s) => s.state?.kpi)
  const wind = useUi((s) => s.state?.sensors.wind_ms)
  const env = useUi((s) => s.state?.safety.envelope)
  const items: [string, string, string?, string?][] = [
    ['Moved', k && typeof k.m3_moved === 'number' ? Math.round(k.m3_moved).toLocaleString('en-GB') : '--', 'm³'],
    ['Load cycles', !k ? '--' : k.cycles > 0 ? String(k.cycles) : 'starting', undefined, k && k.cycles === 0 ? '#c9ecff' : undefined],
    ['Trucks waiting', k ? String(k.trucks_waiting) : '--', undefined, k && k.trucks_waiting > 1 ? '#ffb020' : undefined],
    ['AI cost', aiCost(k), aiCost(k).startsWith('$') ? 'USD' : undefined],
    ['Wind', wind !== undefined ? wind.toFixed(1) : '--', 'm/s', wind !== undefined && wind >= 14 ? '#ffb020' : undefined],
    ['Safety', env ? env.toUpperCase() : '--', undefined, env === 'stop' ? '#ff4d5e' : env === 'warn' ? '#ffb020' : '#3ee6a8'],
  ]
  return (
    <div className="kpis" role="group" aria-label="Site KPIs">
      {items.map(([label, v, unit, color]) => (
        <div className="kpi" key={label}>
          <div className="k">{label}</div>
          <div className={`v ${/[a-z]/.test(v) && v !== '--' ? 'word' : ''}`} style={{ color }}>{v}{unit && <small>{unit}</small>}</div>
        </div>
      ))}
    </div>
  )
}

function TopBar() {
  const conn = useUi((s) => s.conn)
  const ab = useUi((s) => s.abenix)
  const story = useUi((s) => s.story.running)
  const fps = useUi((s) => s.fps)
  const hasLog = useUi((s) => s.captionLog.length > 0)
  const label = conn === 'replay' ? 'Replay' : conn === 'live' ? 'Live' : conn === 'connecting' ? 'Connecting' : 'Sim offline'
  return (
    <header className="topbar glass">
      <div className="brand">
        <div className="brand-mark" aria-hidden>
          <svg width="18" height="18" viewBox="0 0 32 32"><path d="M4 24 L12 10 L18 19 L21 15 L28 24 Z" fill="none" stroke="#5cc8ff" strokeWidth="2.6" strokeLinejoin="round" /><circle cx="24" cy="8" r="3" fill="#ffb020" /></svg>
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="brand-name">Groundwork</div>
          <div className="brand-sub">Northgate Yard ground station</div>
        </div>
      </div>
      <Kpis />
      <div className="top-actions">
        <span className={`status-pill ${conn}`} role="status" title={conn === 'replay' ? 'Synthesised frames for development, not from the simulator or Abenix' : undefined}>
          <span className="dot" />{label}
        </span>
        {conn === 'replay' ? (
          <span className="abenix-mark"><b>REPLAY</b><span>not computed in Abenix</span></span>
        ) : (
          <span className="abenix-mark" title="Every number on screen is computed in Abenix and streamed through the Groundwork backend">
            <b>Computed in Abenix</b>
            <span style={{ color: ab ? (ab.reachable ? '#3ee6a8' : '#ffb020') : undefined }}>{ab ? `${ab.url}${ab.reachable ? '' : ' (unreachable)'}` : 'checking'}</span>
          </span>
        )}
        {hasLog && !story && (
          <button className="btn sm" onClick={downloadSrt} title="Download the story captions as SRT"><Icon name="download" /> SRT</button>
        )}
        {story ? (
          <button className="btn" onClick={stopStory}><Icon name="stop" /> Stop story</button>
        ) : (
          <button className="btn primary" onClick={startStory} disabled={conn === 'offline' || conn === 'connecting'} title="Play the 60 second story (P)">
            <Icon name="play" /> Play the story
          </button>
        )}
        <button className="btn sm" onClick={() => useUi.setState({ help: true })} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)"><Icon name="help" /></button>
        <span className="num faint" style={{ fontSize: 10.5 }} title="Frames per second in this browser">{fps ? `${fps} fps` : ''}</span>
      </div>
    </header>
  )
}

function Help() {
  const open = useUi((s) => s.help)
  if (!open) return null
  const close = () => useUi.setState({ help: false })
  const keys: [string, string][] = [
    ...MODES.map((m) => [m.key, m.label] as [string, string]),
    ['P', 'Play or stop the 60 second story'],
    ['H', 'Hide or show the panels'],
    ['O', 'Cycle survey overlays on and off'],
    ['Space', 'Pause the signal trace'],
    ['Esc', 'Close this, deselect the machine'],
    ['?', 'This list'],
  ]
  return (
    <div className="help-overlay" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={close}>
      <div className="help-card glass" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
          <h3 id="help-title" style={{ flex: 1 }}>Keyboard shortcuts</h3>
          <button className="btn sm" onClick={close} autoFocus aria-label="Close"><Icon name="close" /></button>
        </div>
        <div className="keys">
          {keys.map(([k, v]) => (
            <Fragment key={k}><kbd>{k}</kbd><span>{v}</span></Fragment>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>In the drone feed, drag to move the aircraft, scroll to zoom the camera and hold Shift while scrolling to change altitude. Click a machine or its label to open its panel.</p>
        <p className="disclaimer">Groundwork is a showcase, not certified safety software.</p>
      </div>
    </div>
  )
}

function Toast() {
  const t = useUi((s) => s.toast)
  useEffect(() => {
    if (!t) return
    const id = setTimeout(() => useUi.setState({ toast: null }), 2600)
    return () => clearTimeout(id)
  }, [t])
  if (!t) return null
  return <div className={`toast glass ${t.tone}`} role="status">{t.text}</div>
}

function useKeys() {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const s = useUi.getState()
      const k = e.key.toLowerCase()
      const mode = MODES.find((m) => m.key.toLowerCase() === k)
      if (mode) {
        if (mode.id === 'nervous' && s.cam === 'nervous') setCam(s.prevCam)
        else setCam(mode.id)
        return
      }
      if (k === 'p') s.story.running ? stopStory() : startStory()
      else if (k === 'h') useUi.setState({ panelsHidden: !s.panelsHidden })
      else if (k === '?' || (k === '/' && e.shiftKey)) useUi.setState({ help: !s.help })
      else if (k === 'escape') useUi.setState({ help: false, selected: null })
      else if (k === 'o') {
        const any = Object.values(s.overlays).some(Boolean)
        useUi.setState({ overlays: { geofence: !any, swing: !any, crane: !any, roads: !any, cutfill: false, workers: !any, labels: !any } })
      } else if (k === ' ' && el.tagName !== 'BUTTON') {
        e.preventDefault()
        useUi.setState({ tracePaused: !s.tracePaused })
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])
}

export function App() {
  useKeys()
  const hidden = useUi((s) => s.panelsHidden)
  const story = useUi((s) => s.story.running)
  const cinema = story || CAPTURE && hidden
  return (
    <div className={`app ${hidden && !story ? 'hide-panels' : ''} ${cinema ? 'cinema' : ''}`}>
      <TopBar />
      <aside className="col left" aria-label="Machine panels">
        <VecuConsole />
        <SignalTrace />
      </aside>
      <Feed />
      <aside className="col right" aria-label="AI panels">
        <SitePilot />
        <Autonomy />
        <PhoneApprovals />
      </aside>
      <section className="bottom" aria-label="Site status">
        <LatencyStrip />
        <FaultDeck />
        <Events />
      </section>
      <Help />
      <Toast />
      {REPLAY && <span className="sr-only">Replay mode, synthesised frames</span>}
    </div>
  )
}

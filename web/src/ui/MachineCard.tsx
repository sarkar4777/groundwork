import { Fragment } from 'react'
import { useUi } from '../live/store'
import { ecuStats, sendFault } from '../live/client'
import { ECU_NAMES, Icon, modeTone } from './kit'

export function MachineCard() {
  const sel = useUi((s) => s.selected)
  const m = useUi((s) => s.state?.machines.find((x) => x.id === s.selected))
  const crane = useUi((s) => s.state?.cranes?.find((x) => x.id === s.selected))
  const pc = useUi((s) => (s.selected ? s.state?.ipc?.[s.selected] : undefined))
  if (!sel) return null
  const close = () => useUi.setState({ selected: null })
  if (!m)
    return (
      <aside className="mcard glass" aria-label="Machine">
        <div className="panel-head"><h2>{sel}</h2><button className="btn sm" onClick={close} aria-label="Close"><Icon name="close" /></button></div>
        <div className="panel-body empty">No live state for {sel}</div>
      </aside>
    )
  const ecus = [...(ecuStats.get(m.id)?.values() ?? [])]
  const deg = (r: number) => `${((r * 180) / Math.PI).toFixed(0)}°`
  return (
    <aside className="mcard glass" aria-label={`Machine ${m.id}`}>
      <div className="panel-head" style={{ paddingBottom: 6 }}>
        <h2 style={{ fontSize: 14, letterSpacing: 0, textTransform: 'none' }}>{m.id} <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>{m.kind.replace(/_/g, ' ')}</span></h2>
        {m.src && <span className={`chip ${m.src === 'ipc' ? (m.online === false ? 'stop' : 'ai') : ''}`} title={m.src === 'ipc' ? 'A real J1939 bus behind an industrial PC, read through Abenix telemetry' : 'Simulated in the twin'}>{m.src === 'ipc' ? 'IPC · real bus' : 'Sim'}</span>}
        <span className={`chip ${modeTone(m.mode)}`}>{m.mode}</span>
        <button className="btn sm" onClick={close} aria-label="Close machine panel"><Icon name="close" /></button>
      </div>
      <div className="panel-body">
        <p style={{ margin: '0 0 8px', fontSize: 12.5 }}>{m.task || <span className="faint">No task</span>}</p>
        <dl className="kv">
          <dt>Health</dt><dd style={{ color: m.health === 'ok' ? '#3ee6a8' : m.health === 'warn' ? '#ffb020' : '#ff4d5e' }}>{m.health}</dd>
          <dt>Position E / N</dt><dd>{m.x.toFixed(1)} / {m.y.toFixed(1)} m</dd>
          <dt>Heading</dt><dd>{deg(m.heading)}</dd>
          <dt>Speed</dt><dd>{(m.speed * 3.6).toFixed(1)} km/h</dd>
          <dt>Load</dt><dd>{m.load_t.toFixed(1)} t</dd>
          <dt>Fuel</dt><dd>{Math.round(m.fuel_pct)}%</dd>
          {Object.entries(m.joints).slice(0, 5).map(([k, v]) => (
            <Fragment key={k}><dt>{k}</dt><dd>{/swing|boom|stick|bucket|slew|luff|heading|steer|body/.test(k) ? deg(v) : v.toFixed(2)}</dd></Fragment>
          ))}
          {crane && (<><dt>LMI</dt><dd>{crane.lmi_pct.toFixed(0)}%</dd><dt>Crane wind</dt><dd>{crane.wind_ms.toFixed(1)} m/s</dd></>)}
          {pc && (
            <>
              <dt>Industrial PC</dt><dd>{pc.node} · {pc.online ? 'online' : 'offline'}</dd>
              <dt>Bus</dt><dd>{pc.bus_load_pct != null ? `${pc.bus_load_pct.toFixed(1)}% load` : '--'}{pc.fps != null ? ` · ${pc.fps} frames/s` : ''}{pc.bus_state ? ` · ${pc.bus_state}` : ''}</dd>
              <dt>Safety PLC</dt><dd>{pc.holding ? 'holding' : pc.mode || '--'}{pc.mode_set && pc.mode_set !== 'auto' ? ` · Mode/Set ${pc.mode_set} by ${pc.mode_by === 'outside' ? 'Abenix, an agent or a person' : 'the site fallback'}` : ''}</dd>
            </>
          )}
        </dl>
        <div style={{ marginTop: 8, fontSize: 11 }} className="muted">{ecus.length ? `${ecus.length} ${pc ? 'ECUs heard on its real bus' : 'controllers on the bus'}: ${ecus.map((e) => ECU_NAMES[e.ecu] ?? e.ecu).join(', ')}` : 'No bus frames seen yet'}</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          {pc ? (
            <>
              <button className="btn sm amber" onClick={() => sendFault('unplug_pc', m.id)} disabled={!pc.online}>Unplug the PC</button>
              <button className="btn sm amber" onClick={() => sendFault('noisy_harness', m.id)} disabled={!pc.online}>Noisy harness</button>
            </>
          ) : (
            <>
              <button className="btn sm amber" onClick={() => sendFault('cut_can', m.id)}>Cut CAN</button>
              <button className="btn sm amber" onClick={() => sendFault('drop_gnss', m.id)}>Drop GNSS</button>
            </>
          )}
          <button className="btn sm" onClick={() => useUi.setState({ cam: 'follow' })}>Follow</button>
        </div>
      </div>
    </aside>
  )
}

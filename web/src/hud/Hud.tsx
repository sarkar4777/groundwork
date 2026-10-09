import { useEffect, useRef, useState } from 'react'
import { useUi } from '../live/store'
import { camInfo, drone } from '../scene/CameraRig'
import { ecuStats, busRate } from '../live/client'
import { fmtMs } from '../ui/kit'

function useTick(hz = 15) {
  const [, set] = useState(0)
  useEffect(() => {
    const id = setInterval(() => set((x) => x + 1), 1000 / hz)
    return () => clearInterval(id)
  }, [hz])
}

const timecode = (t: number) => {
  const f = Math.floor((t % 1) * 30)
  const s = Math.floor(t)
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}:${String(f).padStart(2, '0')}`
}

function Compass({ heading }: { heading: number }) {
  const ticks = []
  const labels: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }
  for (let d = -180; d <= 540; d += 5) {
    const n = ((d % 360) + 360) % 360
    const major = n % 15 === 0
    ticks.push(
      <div key={d} className={`compass-tick ${major ? 'major' : ''}`}>
        {n % 45 === 0 ? <span style={{ color: n === 0 ? '#ffb020' : undefined }}>{labels[n]}</span> : major ? <span style={{ opacity: 0.7 }}>{n}</span> : null}
      </div>,
    )
  }
  const offset = -((heading + 180) / 5) * 10
  return (
    <div className="compass" aria-label={`Heading ${Math.round(heading)} degrees`}>
      <div className="compass-strip" style={{ transform: `translateX(${offset}px)` }}>{ticks}</div>
      <div className="compass-caret" />
    </div>
  )
}

function niceScale(metres: number) {
  const steps = [5, 10, 20, 25, 50, 100, 200]
  return steps.find((s) => s >= metres) ?? 200
}

export function DroneHud() {
  useTick(15)
  const st = useUi((s) => s.state)
  const hover = useUi((s) => s.hover)
  const feedH = useRef<HTMLDivElement>(null)
  const dr = st?.machines.find((m) => /drone|uav/i.test(m.kind))
  const gnss = dr ? ecuStats.get(dr.id)?.get('GNSS')?.decoded : undefined
  const sats = gnss && typeof gnss.sats === 'number' ? gnss.sats : null
  const fix = !dr ? 'NO LINK' : dr.health === 'ok' && dr.mode !== 'offline' ? 'RTK FIX' : 'RTK FLOAT'
  const h = feedH.current?.parentElement?.clientHeight ?? 800
  const mpp = (2 * camInfo.alt * Math.tan((camInfo.fov * Math.PI) / 360)) / h
  const scaleM = niceScale(mpp * 110)
  const scalePx = scaleM / mpp
  const flight = (performance.now() - drone.flightStart) / 1000
  const wind = st?.sensors.wind_ms
  return (
    <div className="hud" ref={feedH} aria-hidden>
      <svg className="crosshair" viewBox="0 0 46 46" fill="none" stroke="#f2fbff" strokeWidth="1.2">
        <path d="M23 4v12M23 30v12M4 23h12M30 23h12" />
        <circle cx="23" cy="23" r="2" />
      </svg>
      <div className="tl">
        <div className="hud-row">
          <span className="rec"><i />REC</span>
          <span className="hud-v">{timecode(st?.t ?? 0)}</span>
        </div>
        <div className="hud-row"><span><span className="hud-k">FEED</span><span className="hud-v">{dr?.id ?? 'DRONE'} · NADIR 4K</span></span></div>
        <div className="hud-row"><span><span className="hud-k">FLT</span><span className="hud-v">{Math.floor(flight / 60)}:{String(Math.floor(flight % 60)).padStart(2, '0')}</span></span></div>
      </div>
      <div className="tc">
        <Compass heading={camInfo.heading} />
        <span className="hud-v" style={{ fontSize: 12 }}>HDG {String(Math.round(camInfo.heading) % 360).padStart(3, '0')}°</span>
      </div>
      <div className="tr">
        <div className="hud-row">
          <span style={{ color: fix === 'RTK FIX' ? '#3ee6a8' : '#ffb020' }} className="hud-v">● {fix}</span>
          <span><span className="hud-k">SAT</span><span className="hud-v">{sats ?? '--'}</span></span>
        </div>
        <div className="hud-row">
          <span className="hud-v" style={{ color: dr && dr.fuel_pct < 25 ? '#ff4d5e' : undefined }}>
            <span className="batt"><i style={{ width: `${Math.max(0, Math.min(100, dr?.fuel_pct ?? 0)) * 0.85}%` }} /></span>
            {dr ? `${Math.round(dr.fuel_pct)}%` : '--'}
          </span>
          <span><span className="hud-k">WIND</span><span className="hud-v">{wind !== undefined ? `${wind.toFixed(1)} m/s` : '--'}</span></span>
        </div>
      </div>
      <div className="alt-tape">
        <span className="hud-k">ALT AGL</span>
        <span className="big num">{camInfo.alt.toFixed(1)}<small style={{ fontSize: 11 }}> m</small></span>
      </div>
      <div className="gimbal">
        <span className="hud-k">GIMBAL</span>
        <div className="big num">{camInfo.pitch.toFixed(1)}°</div>
        <span className="hud-k">FOV {camInfo.fov.toFixed(0)}°{camInfo.fov < 56 ? ` · ZOOM ${(Math.tan((58 * Math.PI) / 360) / Math.tan((camInfo.fov * Math.PI) / 360)).toFixed(1)}x` : ''}</span>
      </div>
      <div className="bl">
        <div className="scalebar">
          <span className="hud-v">{scaleM} m</span>
          <div className="bar" style={{ width: scalePx }} />
        </div>
        <span className="hud-box">
          {hover ? (
            <>
              <span className="hud-k">E</span><span className="hud-v">{hover.x.toFixed(1)}</span>{'  '}
              <span className="hud-k">N</span><span className="hud-v">{hover.y.toFixed(1)}</span>{'  '}
              <span className="hud-k">Z</span><span className="hud-v">{hover.z.toFixed(2)} m</span>
            </>
          ) : (
            <span className="hud-k">HOVER FOR SITE GRID E / N / Z</span>
          )}
        </span>
      </div>
      <div className="br">
        <svg className="north" viewBox="0 0 42 42" style={{ transform: `rotate(${-camInfo.heading}deg)` }}>
          <circle cx="21" cy="21" r="19" fill="rgba(4,18,43,0.4)" stroke="rgba(242,251,255,0.6)" />
          <path d="M21 6 L27 24 L21 20 L15 24 Z" fill="#ffb020" />
          <text x="21" y="36" textAnchor="middle" fontSize="9" fill="#f2fbff" fontFamily="JetBrains Mono">N</text>
        </svg>
      </div>
    </div>
  )
}

export function CabHud() {
  useTick(12)
  const st = useUi((s) => s.state)
  const c = st?.cranes?.find((x) => /^TC/i.test(x.id)) ?? st?.cranes?.[0]
  if (!c) return <ModeTag label="CRANE CAB" sub="waiting for crane telemetry" />
  const radius = c.hook ? Math.hypot(c.hook[0] - (st?.machines.find((m) => m.id === c.id)?.x ?? 0), c.hook[1] - (st?.machines.find((m) => m.id === c.id)?.y ?? 0)) : 0
  const lmiTone = c.lmi_pct >= 90 ? '#ff4d5e' : c.lmi_pct >= 75 ? '#ffb020' : '#3ee6a8'
  const windTone = c.wind_ms >= 20 ? '#ff4d5e' : c.wind_ms >= 14 ? '#ffb020' : '#3ee6a8'
  return (
    <div className="hud">
      <CabFrame />
      <div className="tl">
        <span className="hud-box"><span className="hud-k">CAB</span><span className="hud-v">{c.id} · LUFFING JIB</span></span>
      </div>
      <div className="tr" style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', top: 48, right: 70 }}>
        <Gauge label="LMI" value={c.lmi_pct} max={100} unit="%" tone={lmiTone} limit={90} />
        <Gauge label="WIND" value={c.wind_ms} max={30} unit="m/s" tone={windTone} limit={20} />
      </div>
      <div className="tl" style={{ top: 52, left: 70 }}>
        <div className="hud-box" style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: '3px 14px' }}>
          <span className="hud-k">LOAD</span><span className="hud-v">{c.load_t.toFixed(1)} t</span>
          <span className="hud-k">RADIUS</span><span className="hud-v">{radius.toFixed(1)} m</span>
          <span className="hud-k">SLEW</span><span className="hud-v">{((((c.slew * 180) / Math.PI) % 360 + 360) % 360).toFixed(0)}°</span>
          <span className="hud-k">LUFF</span><span className="hud-v">{((c.luff * 180) / Math.PI).toFixed(0)}°</span>
          <span className="hud-k">HOOK Z</span><span className="hud-v">{c.hook[2].toFixed(1)} m</span>
        </div>
      </div>
    </div>
  )
}

function Gauge({ label, value, max, unit, tone, limit }: { label: string; value: number; max: number; unit: string; tone: string; limit: number }) {
  const a0 = -210, a1 = 30
  const ang = (v: number) => ((a0 + (Math.min(max, Math.max(0, v)) / max) * (a1 - a0)) * Math.PI) / 180
  const arc = (from: number, to: number, r: number) => {
    const p = (a: number) => [60 + Math.cos(a) * r, 60 + Math.sin(a) * r]
    const [x0, y0] = p(from), [x1, y1] = p(to)
    return `M${x0} ${y0} A${r} ${r} 0 ${to - from > Math.PI ? 1 : 0} 1 ${x1} ${y1}`
  }
  const a = ang(value)
  return (
    <div className="hud-box" style={{ padding: 6 }}>
      <svg width="118" height="96" viewBox="0 0 120 96" role="img" aria-label={`${label} ${value.toFixed(1)} ${unit}`}>
        <path d={arc(ang(0), ang(max), 46)} stroke="rgba(201,236,255,0.2)" strokeWidth="7" fill="none" strokeLinecap="round" />
        <path d={arc(ang(limit), ang(max), 46)} stroke="rgba(255,77,94,0.55)" strokeWidth="7" fill="none" />
        <path d={arc(ang(0), a, 46)} stroke={tone} strokeWidth="7" fill="none" strokeLinecap="round" />
        <line x1="60" y1="60" x2={60 + Math.cos(a) * 36} y2={60 + Math.sin(a) * 36} stroke="#f2fbff" strokeWidth="2" />
        <text x="60" y="64" textAnchor="middle" fontSize="17" fontWeight="600" fill="#fff" fontFamily="JetBrains Mono">{value.toFixed(value < 10 ? 1 : 0)}</text>
        <text x="60" y="80" textAnchor="middle" fontSize="9.5" fill="rgba(201,236,255,0.75)" fontFamily="JetBrains Mono">{label} {unit}</text>
      </svg>
    </div>
  )
}

function CabFrame({ seat }: { seat?: boolean }) {
  return (
    <svg className="cabframe" viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="pil" x1="0" x2="1">
          <stop offset="0" stopColor="#0a1426" />
          <stop offset="1" stopColor="#1b2a44" />
        </linearGradient>
      </defs>
      <path d={seat ? 'M0 0 H1000 V36 H0Z M0 0 H70 L150 600 H0Z M1000 0 H930 L850 600 H1000Z' : 'M0 0 H1000 V26 H0Z M0 0 H46 L90 600 H0Z M1000 0 H954 L910 600 H1000Z M0 560 H1000 V600 H0Z'} fill="url(#pil)" opacity="0.92" />
      {seat && <path d="M0 520 Q500 470 1000 520 V600 H0Z" fill="#0b1628" opacity="0.9" />}
    </svg>
  )
}

export function ModeTag({ label, sub }: { label: string; sub?: string }) {
  return (
    <div className="hud">
      <div className="tl">
        <span className="hud-box"><span className="hud-k">VIEW</span><span className="hud-v">{label}</span>{sub && <span className="hud-k" style={{ marginLeft: 8 }}>{sub}</span>}</span>
      </div>
    </div>
  )
}

export function SeatHud() {
  useTick(12)
  const st = useUi((s) => s.state)
  const sel = useUi((s) => s.selected)
  const m = st?.machines.find((x) => x.id === sel && /excav/i.test(x.kind)) ?? st?.machines.find((x) => /excav/i.test(x.kind))
  if (!m) return <ModeTag label="OPERATOR SEAT" sub="no excavator in the twin" />
  const deg = (r: number | undefined) => (r === undefined ? '--' : `${((r * 180) / Math.PI).toFixed(0)}°`)
  return (
    <div className="hud">
      <CabFrame seat />
      <div className="tl" style={{ left: 90 }}>
        <span className="hud-box"><span className="hud-k">SEAT</span><span className="hud-v">{m.id} · {m.mode.toUpperCase()}</span></span>
        <span className="hud-box"><span className="hud-k">TASK</span><span className="hud-v" style={{ fontFamily: 'Inter' }}>{m.task || '--'}</span></span>
      </div>
      <div className="tr" style={{ top: 56, right: 90 }}>
        <div className="hud-box" style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: '3px 14px' }}>
          <span className="hud-k">SWING</span><span className="hud-v">{deg(m.joints.swing)}</span>
          <span className="hud-k">BOOM</span><span className="hud-v">{deg(m.joints.boom)}</span>
          <span className="hud-k">STICK</span><span className="hud-v">{deg(m.joints.stick)}</span>
          <span className="hud-k">BUCKET</span><span className="hud-v">{deg(m.joints.bucket)}</span>
          <span className="hud-k">PAYLOAD</span><span className="hud-v">{m.load_t.toFixed(1)} t</span>
        </div>
      </div>
    </div>
  )
}

export function NervousHud() {
  useTick(4)
  const lat = useUi((s) => s.state?.latency)
  return (
    <div className="hud" style={{ fontFamily: 'Inter' }}>
      <div className="tl">
        <span className="hud-box" style={{ fontFamily: 'JetBrains Mono' }}><span className="hud-k">VIEW</span><span className="hud-v">NERVOUS SYSTEM</span></span>
        <div className="hud-box legend" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
          <span><i className="swatch" style={{ background: '#c9ecff' }} />Twin state, every step</span>
          <span><i className="swatch" style={{ background: '#5cc8ff' }} />Bus frames, J1939</span>
          <span><i className="swatch" style={{ background: '#3ee6a8' }} />Safety decisions and Sparkplug sensors</span>
          <span><i className="swatch" style={{ background: '#ff4d5e' }} />Safety stops</span>
          <span><i className="swatch" style={{ background: '#e8f7ff', boxShadow: '0 0 6px #5cc8ff' }} />Agent calls to the Abenix core</span>
        </div>
      </div>
      <div className="tr" style={{ fontFamily: 'JetBrains Mono' }}>
        <span className="hud-box"><span className="hud-k">BUS</span><span className="hud-v">{busRate.perSec}/s</span></span>
        <span className="hud-box"><span className="hud-k">TWIN</span><span className="hud-v">{busRate.ticksPerSec} Hz</span></span>
        <span className="hud-box"><span className="hud-k">RULES</span><span className="hud-v">{fmtMs(lat?.l2_ms)}</span></span>
      </div>
    </div>
  )
}

import { useState, type ReactNode } from 'react'

const paths: Record<string, ReactNode> = {
  chip: <><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" /></>,
  wave: <path d="M2 12h3l3-7 4 14 3-9 2 2h5" />,
  tree: <><circle cx="12" cy="4.5" r="2.2" /><circle cx="5" cy="19" r="2.2" /><circle cx="12" cy="19" r="2.2" /><circle cx="19" cy="19" r="2.2" /><path d="M12 6.7V12M5 16.8V12h14v4.8M12 12v4.8" /></>,
  gauge: <><path d="M3.5 17a9 9 0 1 1 17 0" /><path d="M12 13l4-5" /></>,
  ladder: <><path d="M7 3v18M17 3v18M7 7h10M7 12h10M7 17h10" /></>,
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  bell: <><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z" /><path d="M10 21h4" /></>,
  phone: <><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /></>,
  chev: <path d="m6 9 6 6 6-6" />,
  layers: <><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></>,
  play: <path d="M7 4.5v15l12-7.5z" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  help: <><circle cx="12" cy="12" r="9.5" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17.2v.3" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  download: <><path d="M12 3v12M7 10l5 5 5-5" /><path d="M4 20h16" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  pause: <path d="M8 5v14M16 5v14" />,
  loop: <><path d="M4 12a8 8 0 0 1 14-5.3L20 9" /><path d="M20 4v5h-5" /><path d="M20 12a8 8 0 0 1-14 5.3L4 15" /><path d="M4 20v-5h5" /></>,
  drone: <><circle cx="5" cy="5" r="2.5" /><circle cx="19" cy="5" r="2.5" /><circle cx="5" cy="19" r="2.5" /><circle cx="19" cy="19" r="2.5" /><path d="M7 7l3 3M17 7l-3 3M7 17l3-3M17 17l-3-3" /><rect x="10" y="10" width="4" height="4" rx="1" /></>,
}

export function Icon({ name, className = 'icon', title }: { name: keyof typeof paths | string; className?: string; title?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      {paths[name]}
    </svg>
  )
}

function readCollapsed(key: string, dflt: boolean): boolean {
  try {
    const v = localStorage.getItem('gw.panel.' + key)
    return v === null ? dflt : v === '1'
  } catch {
    return dflt
  }
}

export function Panel({ id, title, icon, children, extra, focus, defaultCollapsed = false, className = '' }: { id: string; title: string; icon: string; children: ReactNode; extra?: ReactNode; focus?: boolean; defaultCollapsed?: boolean; className?: string }) {
  const [collapsed, setCollapsed] = useState(() => readCollapsed(id, defaultCollapsed))
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem('gw.panel.' + id, c ? '0' : '1')
      } catch {
        /* storage unavailable */
      }
      return !c
    })
  }
  return (
    <section className={`glass panel ${collapsed ? 'collapsed' : ''} ${focus ? 'focus' : ''} ${className}`} aria-labelledby={`h-${id}`}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <button className="panel-head" onClick={toggle} aria-expanded={!collapsed} aria-controls={`b-${id}`}>
          <Icon name={icon} />
          <h2 id={`h-${id}`}>{title}</h2>
          <Icon name="chev" className="chev" />
        </button>
        {extra && !collapsed && <div style={{ paddingRight: 10, display: 'flex', gap: 6 }}>{extra}</div>}
      </div>
      <div className="panel-body" id={`b-${id}`}>
        {children}
      </div>
    </section>
  )
}

export const fmtT = (t: number) => {
  const s = Math.max(0, t)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60)
  return `${h ? String(h).padStart(2, '0') + ':' : ''}${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

export const fmtMs = (ms: number | undefined) => {
  if (ms === undefined || ms === null || !isFinite(ms)) return '--'
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)} s`
  if (ms >= 100) return `${Math.round(ms)} ms`
  if (ms >= 10) return `${ms.toFixed(0)} ms`
  return `${ms.toFixed(1)} ms`
}

// plain names for the PC signals Abenix carries by path, the registry has none
const SIGNAL_NAMES: Record<string, string> = {
  'Hydraulics/OilTemp_C': 'hydraulic oil temperature', 'Hydraulics/Pump1Pressure_bar': 'main pump pressure',
  'Hydraulics/Pump2Pressure_bar': 'second pump pressure', 'Hydraulics/BoomPressure_bar': 'boom cylinder pressure',
  'Engine/OilTemp_C': 'engine oil temperature', 'Engine/Coolant_C': 'coolant temperature', 'Engine/Speed_rpm': 'engine speed',
  'GNSS/X_m': 'site position', 'GNSS/Y_m': 'site position',
}

export const signalName = (path: string) => {
  if (SIGNAL_NAMES[path]) return SIGNAL_NAMES[path]
  const last = (path.split('/').pop() || path).replace(/_[A-Za-z%]+$/, '')
  return last.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
}

// a firing's detail in plain words: the signal by name, long decimals to one place
export const plainDetail = (detail: string | undefined, signal?: string) => {
  let s = detail || ''
  if (signal && s.includes(signal)) s = s.split(signal).join(signalName(signal))
  s = s.replace(/-?\d+\.\d{2,}/g, (n) => Number(n).toFixed(1))
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// the PC's gateway forgets a command after 10 s, so a longer ACK time belongs to another command
export const ackMs = (ms: number | null | undefined) => (typeof ms === 'number' && ms <= 10000 ? ms : undefined)

export const modeTone = (mode: string) => (mode === 'auto' ? 'ok' : mode === 'manual' ? 'ai' : mode === 'offline' ? 'stop' : 'warn')

export const ECU_NAMES: Record<string, string> = {
  ENG: 'Engine ECU', HYD: 'Hydraulic controller', SWG: 'Swing and boom', TEL: 'Telematics unit', SPLC: 'Safety PLC',
  TRN: 'Transmission', HST: 'Body hoist', CAS: 'Collision avoidance', SLW: 'Slew drive', LUF: 'Luff drive',
  LMI: 'Load moment indicator', ACU: 'Anti-collision unit', BLD: 'Blade control', MST: 'Mast control', VIB: 'Vibration drum',
  BOOM: 'Boom control', FC: 'Flight controller', GNSS: 'RTK GNSS', CAM: 'Gimbal camera',
  PAY: 'Payload weigher', HOIST: 'Hoist drive', CTL: 'Machine controller', GW: 'Edge gateway', SLEW: 'Slew drive',
}

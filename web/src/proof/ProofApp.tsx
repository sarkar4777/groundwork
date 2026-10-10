import { useEffect, useState } from 'react'
import { useUi } from '../live/store'
import { DroneHud } from '../hud/Hud'
import { ProofScene, SHOWN, type RealMeta } from './ProofScene'
import { Gallery } from './Gallery'

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

function Tags() {
  const ms = useUi((s) => s.state?.machines.filter((m) => SHOWN.test(m.id)).map((m) => `${m.id}:${m.mode}`).join('|') ?? '')
  return (
    <div className="labels" aria-hidden>
      {ms.split('|').filter(Boolean).map((k) => {
        const [id, mode] = k.split(':')
        return (
          <div key={id} className="lbl" data-tag={id}>
            <div>
              <span className="mlabel">
                {id}
                <span className={`md ${mode}`}>SIM · {mode.toUpperCase()}</span>
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function ProofApp() {
  if (new URLSearchParams(location.search).get('gallery')) return <Gallery />
  return <ProofPage />
}

function ProofPage() {
  const [meta, setMeta] = useState<RealMeta | null>(null)
  const [err, setErr] = useState('')
  const conn = useUi((s) => s.conn)
  useEffect(() => {
    const site = new URLSearchParams(location.search).get('site') ?? 'nh108'
    fetch(`/real/${site}/meta.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Real imagery is not fetched yet. Run python scripts/fetch-real-imagery.py'))))
      .then(setMeta)
      .catch((e) => setErr(String(e.message ?? e)))
  }, [])
  if (err) return <div className="proof-empty">{err}</div>
  if (!meta) return <div className="proof-empty">Loading the real site</div>
  return (
    <div className="proof">
      <ProofScene meta={meta} />
      <DroneHud />
      <Tags />
      <div className="proof-credit">
        <div>
          <b>REAL</b> drone orthophoto of a live excavation, {fmtDate(meta.capture_utc[0])}. {meta.attribution}. Parked machines retouched out.
        </div>
        <div>
          <b className="sim">SIMULATED</b> machines from the Groundwork twin, {conn === 'recorded' ? 'a recorded live run' : conn === 'live' ? 'live' : conn}, lit by the sun at capture: {Math.round(meta.sun.azimuth_deg)}° azimuth, {Math.round(meta.sun.elevation_deg)}° up.
        </div>
      </div>
    </div>
  )
}

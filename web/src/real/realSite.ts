import { hot } from '../live/hot'
import { useUi } from '../live/store'
import { groundState } from '../scene/ground/heights'

// What scripts/fetch-real-imagery.py and scripts/reconstruct.py write next to the tiles.
export interface RealMeta {
  site: string
  kind?: 'orthophoto' | 'reconstruction'
  title: string
  attribution: string
  licence?: string
  capture_utc: [string, string] | null
  gsd_m?: number
  detail?: { file: string; rect: [number, number, number, number] }
  surround?: { file: string; rect: [number, number, number, number] }
  ortho?: { file: string; rect: [number, number, number, number] }
  grid?: { n: number; extent: number; dsm: string; dtm: string }
  splat?: { file: string } | null
  sun: { azimuth_deg: number; elevation_deg: number; at_utc: string } | null
  // shadowed over sunlit ground, linear, measured from the photo
  shadow_ratio?: [number, number, number]
}

export const base: Record<string, string> = {}
export const realUrl = (site: string, file: string) => `${base[site] ?? `/real/${site}`}/${file}`

export const real = { meta: null as RealMeta | null, site: '', heights: null as Float32Array | null }

let loading = ''
// ?ground=caliterra lays any prepared site under the live twin, for checking a reconstruction
const FORCED = new URLSearchParams(location.search).get('ground') ?? ''

// The site layout says when the twin runs on real ground. The tiles come from data/real through the dev server.
export async function syncReal(): Promise<void> {
  const want = FORCED || (hot.site?.imagery?.site ?? '')
  if (want === real.site) return
  if (!want) {
    real.site = ''
    real.meta = null
    real.heights = null
    useUi.setState({ realGround: null })
    return
  }
  if (loading === want) return
  loading = want
  try {
    let r = await fetch(`/real/${want}/meta.json`)
    // a reconstruction keeps its web files in site/
    if (!r.ok) r = await fetch(`/real/${want}/site/meta.json`)
    if (r.ok && r.url.includes('/site/meta.json')) base[want] = `/real/${want}/site`
    if (!r.ok) throw new Error(`real imagery for ${want} is not fetched, run python scripts/fetch-real-imagery.py`)
    const meta = (await r.json()) as RealMeta
    let heights: Float32Array | null = null
    if (meta.grid) {
      const b = await fetch(realUrl(want, meta.grid.dsm))
      if (b.ok) heights = new Float32Array(await b.arrayBuffer())
    }
    real.site = want
    real.meta = meta
    real.heights = heights
    // an orthophoto is flat ground, a reconstruction brings its own heights
    groundState.n = heights ? meta.grid!.n : 0
    groundState.extent = heights ? meta.grid!.extent : 200
    groundState.shown = heights
    groundState.target = heights
    groundState.morph = 1
    useUi.setState({ realGround: { site: want, attribution: meta.attribution, captured: meta.capture_utc?.[0] ?? null }, siteError: null })
  } catch (e) {
    useUi.setState({ siteError: String(e instanceof Error ? e.message : e) })
  } finally {
    loading = ''
  }
}

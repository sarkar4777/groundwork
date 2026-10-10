import { useEffect, useState } from 'react'
import { useUi } from '../live/store'
import { hot } from '../live/hot'

type Focus = 'all' | 'right' | 'left' | 'bottom'

// The platform beat: the full ground station, one panel group lit at a time, with its own subtitles.
// Times are on the bff story clock. The camera moves at `from`, the subtitle follows once it has landed.
export const TOUR: { from: number; to: number; focus: Focus; text: string }[] = [
  { from: 32.1, to: 35.7, focus: 'all', text: 'The whole site on one screen.\nEvery number live from Abenix.' },
  { from: 35.7, to: 39.3, focus: 'right', text: 'AI back on. Agents, models and pipelines return,\nand the event log records every change.' },
  { from: 39.3, to: 42.9, focus: 'left', text: "Every machine's controllers, live on the bus.\nEvery J1939 and Sparkplug frame decoded." },
  { from: 42.9, to: 46.5, focus: 'bottom', text: 'Every layer timed in Abenix,\nfrom the twin step to the agents.' },
]

const MOVE_S = 1.0
const LAND = MOVE_S * 0.85

const SELECTORS: Record<Exclude<Focus, 'all'>, { land: string[]; port: string[] }> = {
  right: { land: ['.col.right', '.bottom > :nth-child(3)'], port: ['.bottom > :nth-child(3)'] },
  left: { land: ['.col.left'], port: ['.col.left'] },
  bottom: { land: ['.bottom > :first-child'], port: ['.bottom > :first-child'] },
}

function storyT() {
  const s = useUi.getState().story
  return hot.curr ? hot.curr.t + (performance.now() - hot.currAt) / 1000 - s.t0 : 0
}

// Rect of the elements in the untransformed 1920x1080 layout, from offsets so transforms do not matter.
function layoutRect(app: HTMLElement, sels: string[]) {
  const rs = sels.flatMap((q) => [...app.querySelectorAll<HTMLElement>(q)]).map((e) => {
    let x = 0, y = 0
    let n: HTMLElement | null = e
    while (n && n !== app) {
      x += n.offsetLeft
      y += n.offsetTop
      n = n.offsetParent as HTMLElement | null
    }
    return { x0: x, y0: y, x1: x + e.offsetWidth, y1: y + e.offsetHeight }
  })
  if (!rs.length) return null
  return { x0: Math.min(...rs.map((r) => r.x0)), y0: Math.min(...rs.map((r) => r.y0)), x1: Math.max(...rs.map((r) => r.x1)), y1: Math.max(...rs.map((r) => r.y1)) }
}

const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)))

export function useTour(active: boolean) {
  const [focus, setFocus] = useState<Focus>('all')
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => {
      const t = storyT()
      const step = TOUR.find((c) => t >= c.from && t < c.to) ?? (t < TOUR[0].from ? TOUR[0] : TOUR[TOUR.length - 1])
      setFocus(step.focus)
    }, 50)
    return () => clearInterval(id)
  }, [active])
  useEffect(() => {
    const app = document.querySelector<HTMLElement>('.app')
    if (!app) return
    if (!active) {
      app.style.transform = ''
      delete document.body.dataset.tourcap
      return
    }
    const vw = innerWidth, vh = innerHeight
    const portrait = vh > vw
    const W = 1920, H = 1080
    // the desktop always fills the frame, subtitles sit on it away from the lit group
    const fill = Math.max(vw / W, vh / H)
    let s = fill
    let x = (vw - W * s) / 2, y = (vh - H * s) / 2
    let capTop = false
    if (focus === 'all' && portrait) {
      // a phone shows the feed and the inspector, the heart of the screen
      const r = layoutRect(app, ['.feed'])
      if (r) x = clamp(vw / 2 - ((r.x0 + r.x1) / 2) * s, vw - W * s, 0)
    }
    if (focus !== 'all') {
      const r = layoutRect(app, portrait ? SELECTORS[focus].port : SELECTORS[focus].land)
      if (r) {
        const pad = 18
        const rw = r.x1 - r.x0 + pad * 2, rh = r.y1 - r.y0 + pad * 2
        // room for the subtitle band, about a fifth of the frame
        const room = vh * 0.78
        s = Math.max(fill, Math.min(portrait ? 1.7 : fill * 1.32, vw / rw, room / rh))
        const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2
        x = clamp(vw / 2 - cx * s, vw - W * s, 0)
        y = clamp(vh / 2 - cy * s, vh - H * s, 0)
        // put the subtitle on the side of the frame the lit group is not on
        const litY = cy * s + y
        capTop = litY > vh * 0.55
        // if the lit group still runs under the subtitle band, slide it clear when the edge allows
        const bandH = vh * 0.2
        if (!capTop && (r.y1 + pad) * s + y > vh - bandH) y = clamp(vh - bandH - (r.y1 + pad) * s, vh - H * s, 0)
        if (capTop && (r.y0 - pad) * s + y < bandH) y = clamp(bandH - (r.y0 - pad) * s, vh - H * s, 0)
      }
    }
    app.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${s.toFixed(4)})`
    app.dataset.tour = focus
    // landscape keeps the subtitle on the dimmed half, beside the lit column
    const place = !portrait && focus === 'right' ? 'side-left' : !portrait && focus === 'left' ? 'side-right' : capTop ? 'top' : 'bottom'
    const set = () => (document.body.dataset.tourcap = place)
    const id = setTimeout(set, LAND * 1000)
    return () => clearTimeout(id)
  }, [active, focus])
  return focus
}

export function TourCaption() {
  const [text, setText] = useState(TOUR[0].text)
  useEffect(() => {
    const id = setInterval(() => {
      const t = storyT()
      // the line changes once the camera has landed on its panel
      let step = TOUR[0]
      for (const c of TOUR) if (t >= (c === TOUR[0] ? c.from : c.from + LAND)) step = c
      setText(step.text)
    }, 50)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="tour-captions" aria-live="polite">
      <div className="caption" key={text}>{text}</div>
    </div>
  )
}

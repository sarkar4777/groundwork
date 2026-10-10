import { useEffect, useRef, useState } from 'react'
import { useUi } from '../live/store'
import { hot } from '../live/hot'

// The platform beat: the full ground station, one panel group lit at a time, with its own subtitles.
// Times are on the bff story clock, inside the platform beat.
export const TOUR: { from: number; to: number; focus: 'all' | 'right' | 'left' | 'bottom'; text: string }[] = [
  { from: 33, to: 35.1, focus: 'all', text: 'The whole site on one screen.\nEvery number live from Abenix.' },
  { from: 35.1, to: 37.3, focus: 'right', text: 'AI back on. Agents, models and pipelines return,\nand the event log records every change.' },
  { from: 37.3, to: 39.5, focus: 'left', text: "Every machine's controllers, live on the bus.\nEvery J1939 and Sparkplug frame decoded." },
  { from: 39.5, to: 41.5, focus: 'bottom', text: 'Every layer timed in Abenix,\nfrom the twin step to the agents.' },
]

const SELECTORS: Record<string, string[]> = {
  right: ['.col.right', '.bottom > :nth-child(3)'],
  left: ['.col.left'],
  bottom: ['.bottom > :first-child'],
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

export function useTour(active: boolean) {
  const [focus, setFocus] = useState<string>('all')
  const cur = useRef({ s: 1, x: 0, y: 0 })
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => {
      const t = storyT()
      const step = TOUR.find((c) => t >= c.from && t < c.to) ?? (t < TOUR[0].from ? TOUR[0] : TOUR[TOUR.length - 1])
      setFocus(step.focus)
    }, 100)
    return () => clearInterval(id)
  }, [active])
  useEffect(() => {
    const app = document.querySelector<HTMLElement>('.app')
    if (!app) return
    if (!active) {
      app.style.transform = ''
      cur.current = { s: 1, x: 0, y: 0 }
      return
    }
    const vw = innerWidth, vh = innerHeight
    const portrait = vh > vw
    const W = 1920, H = 1080
    const top = portrait ? vh * 0.05 : 0
    const availH = portrait ? vh * 0.7 : vh
    const fit = Math.min(vw / W, availH / H)
    let s = fit, x = (vw - W * fit) / 2, y = top + (availH - H * fit) / 2
    // a phone frame has room for the events panel alone when the right side is lit
    const sels = portrait && focus === 'right' ? ['.bottom > :nth-child(3)'] : SELECTORS[focus]
    const r = focus === 'all' ? null : layoutRect(app, sels)
    if (r) {
      const pad = 16
      const rw = r.x1 - r.x0 + pad * 2, rh = r.y1 - r.y0 + pad * 2
      // landscape keeps the whole UI and leans in, portrait flies to the lit group
      s = portrait ? Math.min(vw / rw, availH / rh, 1.6) : fit * 1.07
      const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2
      x = vw / 2 - cx * s
      y = top + availH / 2 - cy * s
      const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)))
      x = clamp(x, vw - W * s, 0)
      if (!portrait) y = clamp(y, vh - H * s, 0)
    }
    cur.current = { s, x, y }
    app.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${s.toFixed(4)})`
    app.dataset.tour = focus
  }, [active, focus])
  return focus
}

export function TourCaption() {
  const [text, setText] = useState('')
  useEffect(() => {
    const id = setInterval(() => {
      const t = storyT()
      setText(TOUR.find((c) => t >= c.from - 0.05 && t < c.to)?.text ?? TOUR[0].text)
    }, 100)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="tour-captions" aria-live="polite">
      <div className="caption" key={text}>{text}</div>
    </div>
  )
}

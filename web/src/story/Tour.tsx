import { useEffect, useLayoutEffect, useState } from 'react'
import { useUi } from '../live/store'
import { hot } from '../live/hot'

type Focus = 'all' | 'right' | 'left' | 'bottom' | 'feed' | 'deck' | 'card' | 'trace' | 'phone' | 'loop' | 'streams'

interface Step { from: number; to: number; focus: Focus; text: string; press?: { at: number; label: string } }

// The platform beat: the full ground station, one panel group lit at a time, with its own subtitles.
// Times are on the bff story clock. The camera moves at `from`, the subtitle follows once it has landed.
export const TOUR: Step[] = [
  { from: 32.1, to: 35.7, focus: 'all', text: 'The whole site on one screen.\nEvery number live from Abenix.' },
  { from: 35.7, to: 39.3, focus: 'right', text: 'AI back on. Agents, models and pipelines return,\nand the event log records every change.' },
  { from: 39.3, to: 42.9, focus: 'left', text: "Every machine's controllers, live on the bus.\nEvery J1939 and Sparkplug frame decoded." },
  { from: 42.9, to: 46.5, focus: 'bottom', text: 'Every layer timed in Abenix,\nfrom the twin step to the agents.' },
]

// The industrial PC story's turns on the whole ground station. '@caption' shows the bff's own line, numbers and all.
const IPC_TOUR: Step[] = [
  { from: 13, to: 20, focus: 'all', text: '@caption' },
  { from: 20, to: 25, focus: 'feed', text: 'Four machines run on their own industrial PCs, the rest are simulated.\nThe labels say which: IPC · REAL BUS or SIM.' },
  { from: 25, to: 28.6, focus: 'deck', text: "We unplug EX1's PC from the fault deck.\nIt drops off MQTT without a goodbye.", press: { at: 26.5, label: "Unplug EX1's PC" } },
  { from: 28.6, to: 34, focus: 'card', text: "Abenix sees it die on the broker, and EX1's own safety PLC holds it.\nIts console and its card show the PC offline." },
  { from: 37, to: 42, focus: 'streams', text: "On the left, EX1's controllers stream live from its PC again.\nBottom left, every frame on its bus decoded, and every layer timed." },
  { from: 42, to: 44.6, focus: 'deck', text: 'A noisy harness on EX1, from the fault deck.', press: { at: 42.5, label: 'Noisy harness on EX1' } },
  { from: 44.6, to: 50, focus: 'trace', text: "Error frames and retransmits on EX1's wire, each frame tagged IPC.\nThe bus keeps going." },
]

// The closed loop's turns hang off the steps the take reached, on the same clock.
function loopTour(): Step[] {
  const st = useUi.getState().story
  const at = (k: string) => (st.steps?.[k] !== undefined ? st.steps[k] - st.t0 : undefined)
  const asked = at('asked'), done = at('taken') ?? at('nocmd')
  const out: Step[] = []
  if (asked !== undefined) out.push({ from: asked, to: done ?? asked + 600, focus: 'phone', text: "It asks to put EX1 in safe mode. A person decides in Abenix,\nand the site manager's phone shows the request." })
  if (done !== undefined) out.push({ from: done, to: done + 6, focus: 'loop', text: '@caption' })
  return out
}

function steps(): Step[] {
  const st = useUi.getState().story
  return st.loop ? loopTour() : st.ipc ? IPC_TOUR : TOUR
}

const MOVE_S = 1.0
const LAND = MOVE_S * 0.9

const SELECTORS: Record<Exclude<Focus, 'all'>, { land: string[]; port: string[] }> = {
  right: { land: ['.col.right', '.bottom > :nth-child(3)'], port: ['.bottom > :nth-child(3)'] },
  left: { land: ['.col.left'], port: ['.col.left'] },
  bottom: { land: ['.bottom > :first-child'], port: ['.bottom > :first-child'] },
  feed: { land: ['.feed'], port: ['.feed'] },
  streams: { land: ['section[aria-labelledby="h-vecu"]', 'section[aria-labelledby="h-trace"]', 'section[aria-labelledby="h-latency"]'], port: ['section[aria-labelledby="h-vecu"]', 'section[aria-labelledby="h-trace"]'] },
  deck: { land: ['section[aria-labelledby="h-faults"]'], port: ['section[aria-labelledby="h-faults"]'] },
  card: { land: ['section[aria-labelledby="h-vecu"]', 'aside.mcard'], port: ['aside.mcard'] },
  trace: { land: ['section[aria-labelledby="h-trace"]'], port: ['section[aria-labelledby="h-trace"]'] },
  phone: { land: ['section[aria-labelledby="h-loop"]', 'section[aria-labelledby="h-phone"]'], port: ['section[aria-labelledby="h-phone"]'] },
  loop: { land: ['section[aria-labelledby="h-events"]'], port: ['section[aria-labelledby="h-events"]'] },
}

// the take's fault deck press, on the button a person would use, at the moment the take sent it
function press(step: Step | undefined, t: number) {
  const on = !!step?.press && t >= step.press.at && t < step.press.at + 0.8
  document.querySelectorAll<HTMLElement>('.tour-press').forEach((e) => {
    if (!on || !e.innerText.startsWith(step!.press!.label)) e.classList.remove('tour-press')
  })
  if (!on) return
  const b = [...document.querySelectorAll<HTMLElement>('.app .bottom button')].find((e) => e.innerText.trim().startsWith(step!.press!.label))
  b?.classList.add('tour-press')
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

// One clock drives both the camera and the subtitle, so they can never drift apart.
export const tourState = { text: '', visible: false }
const say = (text: string) => (text === '@caption' ? useUi.getState().caption?.text ?? '' : text)
type Listener = () => void
const listeners = new Set<Listener>()

// The camera over the desktop moves on the page clock, so a frame-stepped render gets every in-between.
const cam = { x: 0, y: 0, s: 1, from: { x: 0, y: 0, s: 1 }, to: { x: 0, y: 0, s: 1 }, t0: -1e9, live: false, raf: 0 }
const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2)

function moveCamera(app: HTMLElement, to: { x: number; y: number; s: number }, snap: boolean) {
  cam.from = { x: cam.x, y: cam.y, s: cam.s }
  cam.to = to
  cam.t0 = snap ? -1e9 : performance.now()
  if (cam.live) return
  cam.live = true
  const step = () => {
    if (!cam.live) return
    const k = ease(Math.min(1, (performance.now() - cam.t0) / (MOVE_S * 1000)))
    cam.x = cam.from.x + (cam.to.x - cam.from.x) * k
    cam.y = cam.from.y + (cam.to.y - cam.from.y) * k
    cam.s = cam.from.s + (cam.to.s - cam.from.s) * k
    app.style.transform = `translate(${cam.x.toFixed(2)}px, ${cam.y.toFixed(2)}px) scale(${cam.s.toFixed(5)})`
    cam.raf = requestAnimationFrame(step)
  }
  step()
}

export function useTour(active: boolean, opening = false) {
  const [focus, setFocus] = useState<Focus>('all')
  // a turn starts with no line on screen, so the last turn's line never shows for a frame
  useLayoutEffect(() => {
    const clear = () => {
      Object.assign(tourState, { text: '', visible: false })
      listeners.forEach((l) => l())
    }
    clear()
    return clear
  }, [active])
  useEffect(() => {
    if (!active || opening) return
    const id = setInterval(() => {
      const t = storyT()
      const list = steps()
      if (!list.length) return
      let i = list.findIndex((c) => t >= c.from && t < c.to)
      if (i < 0) i = t < list[0].from ? 0 : list.findIndex((c) => c.from > t) > 0 ? list.findIndex((c) => c.from > t) - 1 : list.length - 1
      setFocus(list[i].focus)
      press(list[i], t)
      // the old line fades as the camera leaves, none while it moves, the new one once it lands
      const joined = i > 0 && list[i - 1].to === list[i].from
      const moving = joined && t < list[i].from + MOVE_S
      const entering = !joined && t < list[i].from + LAND
      const leaving = i < list.length - 1 && list[i + 1].from === list[i].to && t > list[i].to - 0.2
      const next = { text: say(moving ? list[i - 1].text : list[i].text), visible: !moving && !entering && !leaving }
      if (next.text !== tourState.text || next.visible !== tourState.visible) {
        Object.assign(tourState, next)
        listeners.forEach((l) => l())
      }
    }, 33)
    return () => clearInterval(id)
  }, [active, opening])
  useEffect(() => {
    const app = document.querySelector<HTMLElement>('.app')
    if (!app) return
    if (!active) {
      app.classList.remove('litmode')
      app.querySelectorAll('.tour-lit').forEach((e) => e.classList.remove('tour-lit'))
      cam.live = false
      cancelAnimationFrame(cam.raf)
      app.style.transform = ''
      delete document.body.dataset.tourcap
      return
    }
    const first = !cam.live
    // set first, the layout of a turn can depend on it
    app.dataset.tour = opening ? 'opening' : focus
    const vw = innerWidth, vh = innerHeight
    const portrait = vh > vw
    const W = 1920, H = 1080
    // the desktop always fills the frame, subtitles sit on it away from the lit group
    const fill = Math.max(vw / W, vh / H)
    let s = fill
    let x = (vw - W * s) / 2, y = (vh - H * s) / 2
    let capTop = false
    if (opening) {
      // the whole window, contained, with room under it for the title on a phone
      s = Math.min(vw / W, (portrait ? vh * 0.5 : vh) / H)
      x = (vw - W * s) / 2
      y = portrait ? vh * 0.1 : (vh - H * s) / 2
    } else if (focus === 'all' && portrait) {
      // a phone shows the feed and the inspector, the heart of the screen
      const r = layoutRect(app, ['.feed'])
      if (r) x = clamp(vw / 2 - ((r.x0 + r.x1) / 2) * s, vw - W * s, 0)
    }
    if (!opening && focus !== 'all') {
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
    moveCamera(app, { x, y, s }, first || opening)
    app.dataset.tour = opening ? 'opening' : focus
    // the newer turns light their own panels, the rest of the station dims
    app.querySelectorAll('.tour-lit').forEach((e) => e.classList.remove('tour-lit'))
    const lit = !opening && !['all', 'right', 'left', 'bottom'].includes(focus)
    app.classList.toggle('litmode', lit)
    const extra: Partial<Record<Focus, string[]>> = { loop: ['section[aria-labelledby="h-loop"]'] }
    if (lit) [...SELECTORS[focus as Exclude<Focus, 'all'>].land, ...(extra[focus] ?? [])].forEach((q) => app.querySelectorAll(q).forEach((e) => e.classList.add('tour-lit')))
    // landscape keeps the subtitle on the dimmed half, beside the lit column
    const place = !portrait && focus === 'right' ? 'side-left' : !portrait && focus === 'left' ? 'side-right' : capTop ? 'top' : 'bottom'
    const set = () => (document.body.dataset.tourcap = place)
    const id = setTimeout(set, LAND * 1000)
    return () => clearTimeout(id)
  }, [active, focus, opening])
  return focus
}

export function TourCaption() {
  const [, bump] = useState(0)
  useEffect(() => {
    const l = () => bump((x) => x + 1)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return (
    <div className="tour-captions" aria-live="polite">
      {tourState.text && <div className={`caption ${tourState.visible ? '' : 'off'}`}>{tourState.text}</div>}
    </div>
  )
}

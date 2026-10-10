// Plays back one recorded live take (scripts/record-take.mjs) on the page's own clock.
// capture.mjs installs a virtual clock and steps it 1/60 s per frame, so every frame of the film
// is rendered from the real run at exact, even times. Nothing here is synthesised.
import type { Frame } from '../proto/types'

interface Take {
  frames: { w: number; f: Frame }[]
  terrain: Record<string, unknown>
  site: unknown
  site_story?: unknown
  agents: { at: number; data: unknown }[]
  health: Record<string, unknown> | null
  storyAt: number
}

type Emit = (f: Frame, at?: number) => void

const PRE_S = 6.6

export class Playback {
  private take!: Take
  private sched: { v: number; f: Frame; i: number }[] = []
  private next = 0
  private v0 = -1
  private emit: Emit
  storyV = 0
  endV = 0
  ready = false

  constructor(emit: Emit) {
    this.emit = emit
  }

  async load(url = '/__take.json') {
    const r = await fetch(url)
    if (!r.ok) throw new Error(`no recorded take at ${url}`)
    this.take = (await r.json()) as Take
    const fr = this.take.frames
    const sAt = this.take.storyAt
    const tOf = (f: Frame) => (typeof (f as { t?: unknown }).t === 'number' ? (f as { t: number }).t : NaN)
    // segment A: the running site just before the story, the last PRE_S seconds of sim time
    const preStates = fr.slice(0, sAt).filter((x) => x.f.type === 'state')
    const tAEnd = preStates.length ? tOf(preStates[preStates.length - 1].f) : 0
    const tA0 = tAEnd - PRE_S
    let lastA = 0
    fr.slice(0, sAt).forEach((x, i) => {
      const t = tOf(x.f)
      if (x.f.type === 'plan' && !isFinite(t)) return this.sched.push({ v: 0, f: x.f, i })
      if (!isFinite(t) || t < tA0) return
      const v = t - tA0
      lastA = Math.max(lastA, v)
      this.sched.push({ v, f: x.f, i })
    })
    // segment B: the story, on its own sim clock from its start event
    this.storyV = lastA + 0.05
    fr.slice(sAt).forEach((x, k) => {
      const t = tOf(x.f)
      const v = this.storyV + (isFinite(t) ? Math.max(0, t) : 0)
      this.sched.push({ v, f: x.f, i: sAt + k })
    })
    this.sched.sort((a, b) => a.v - b.v || a.i - b.i)
    this.endV = this.sched[this.sched.length - 1]?.v ?? 0
    // the first state so the scene builds while the page warms up
    const first = this.sched.find((x) => x.f.type === 'state')
    if (first) this.emit(first.f, performance.now())
    this.ready = true
  }

  go() {
    this.v0 = performance.now()
    this.next = 0
    const tick = () => {
      this.pump()
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    setInterval(() => this.pump(), 5)
  }

  vNow() {
    return this.v0 < 0 ? -1 : (performance.now() - this.v0) / 1000
  }

  private pump() {
    if (this.v0 < 0) return
    const v = this.vNow()
    while (this.next < this.sched.length && this.sched[this.next].v <= v) {
      const s = this.sched[this.next++]
      this.emit(s.f, this.v0 + s.v * 1000)
    }
  }

  inStory() {
    return this.v0 >= 0 && this.vNow() >= this.storyV
  }

  terrain(rev: number) {
    const t = this.take.terrain[`${this.inStory() ? 'b' : 'a'}:${rev}`] ?? this.take.terrain[String(rev)]
    if (!t) throw new Error(`terrain rev ${rev} not in the take`)
    return t
  }

  site() {
    return this.take.site_story ?? this.take.site
  }

  agents() {
    const done = this.sched[Math.max(0, this.next - 1)]?.i ?? 0
    let best = this.take.agents[0]?.data
    for (const a of this.take.agents) if (a.at <= done) best = a.data
    return best ?? []
  }

  health() {
    return this.take.health
  }
}

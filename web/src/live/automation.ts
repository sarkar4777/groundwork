import { setCam, useUi, type CamMode } from './store'
import { playback, startStory, stopStory } from './client'
import { toSrt } from '../story/StoryLayer'
import { hot } from './hot'

// A small handle for scripts/capture.mjs and browser tests. Everything goes through the same paths the UI uses.
const starts = new WeakMap<Animation, number>()

export function installAutomation() {
  const api = {
    status: () => {
      const s = useUi.getState()
      return {
        conn: s.conn,
        hasState: !!s.state,
        t: s.state?.t ?? null,
        terrain: !!hot.terrain,
        site: !!hot.site,
        story: s.story.running,
        storyT: s.story.running && hot.curr ? hot.curr.t - s.story.t0 : null,
        recorded: s.story.recorded,
        fps: s.fps,
      }
    },
    startStory,
    stopStory,
    cam: (m: CamMode) => setCam(m),
    select: (id: string | null) => useUi.setState({ selected: id }),
    panels: (show: boolean) => useUi.setState({ panelsHidden: !show }),
    clean: (on: boolean) => document.body.classList.toggle('shot-clean', on),
    go: () => playback()?.go(),
    timeline: () => {
      const p = playback()
      return p ? { ready: p.ready, storyV: p.storyV, endV: p.endV, v: p.vNow() } : null
    },
    // CSS animations run on real time, so a stepped render puts each one on the page clock instead
    frame: () => {
      const now = performance.now()
      for (const a of document.getAnimations()) {
        let t0 = starts.get(a)
        if (t0 === undefined) {
          t0 = now
          starts.set(a, t0)
          a.pause()
        }
        a.currentTime = now - t0
      }
    },
    srt: () => {
      const s = useUi.getState()
      return toSrt(s.captionLog, s.story.t0)
    },
  }
  ;(window as unknown as { __gw: typeof api }).__gw = api
}

import { setCam, useUi, type CamMode } from './store'
import { startStory, stopStory } from './client'
import { toSrt } from '../story/StoryLayer'
import { hot } from './hot'

// A small handle for scripts/capture.mjs and browser tests. Everything goes through the same paths the UI uses.
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
    srt: () => {
      const s = useUi.getState()
      return toSrt(s.captionLog, s.story.t0)
    },
  }
  ;(window as unknown as { __gw: typeof api }).__gw = api
}

// With ?render=1 the page draws only when scripts/capture.mjs steps it, one film frame at a time.
type W = Window & { __gwStep?: () => number; __gwNow?: (ms: number | null) => void }

if (new URLSearchParams(location.search).get('render') === '1') {
  // the page clock only steps whole milliseconds, a film frame is 16.67 ms
  const clock = performance.now.bind(performance)
  let exact: number | null = null
  performance.now = () => exact ?? clock()
  ;(window as W).__gwNow = (ms) => {
    exact = ms
  }
  let q: [number, FrameRequestCallback][] = []
  let id = 0
  window.requestAnimationFrame = (cb) => {
    q.push([++id, cb])
    return id
  }
  window.cancelAnimationFrame = (h) => {
    q = q.filter((x) => x[0] !== h)
  }
  ;(window as W).__gwStep = () => {
    const run = q
    q = []
    const now = performance.now()
    for (const [, cb] of run) {
      try {
        cb(now)
      } catch (e) {
        console.error(e)
      }
    }
    return run.length
  }
}

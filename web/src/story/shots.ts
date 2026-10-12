import * as THREE from 'three'
import type { CamMode } from '../live/store'
import { hot } from '../live/hot'
import { dronePose, orbitPose } from '../scene/CameraRig'
import { useUi } from '../live/store'

interface Pose { pos: THREE.Vector3; look: THREE.Vector3; fov: number }

export type Focus = 'phone' | 'latency' | 'gust' | 'aioff' | 'code' | 'autonomy' | 'endcard' | 'hops' | 'pc' | 'oil' | 'loop'

export interface Beat { from: number; to: number; name: string; mode: CamMode; focus?: Focus }

// PLAN.md section 13 on the bff's story clock. capture.mjs cuts the kept part of each beat.
export const BEATS: Beat[] = [
  { from: 0, to: 4, name: 'hero', mode: 'drone' },
  { from: 4, to: 9, name: 'stop', mode: 'drone' },
  { from: 9, to: 14, name: 'replan', mode: 'drone', focus: 'phone' },
  { from: 14, to: 21, name: 'nervous', mode: 'nervous', focus: 'latency' },
  { from: 21, to: 28, name: 'gust', mode: 'drone', focus: 'gust' },
  { from: 28, to: 32.1, name: 'aioff', mode: 'drone', focus: 'aioff' },
  { from: 32.1, to: 46.5, name: 'platform', mode: 'drone' },
  { from: 46.5, to: 51.1, name: 'newmachine', mode: 'drone', focus: 'code' },
  { from: 51.1, to: 55.6, name: 'autonomy', mode: 'drone', focus: 'autonomy' },
  { from: 55.6, to: 70, name: 'end', mode: 'orbit', focus: 'endcard' },
]

// The industrial PC story, live on the bff's clock. 50 to 58 s is where the film cuts to Abenix.
// tour_ beats show the whole ground station, Tour.tsx moves over it and captions it
export const IPC_BEATS: Beat[] = [
  { from: 0, to: 6, name: 'hero', mode: 'drone' },
  { from: 6, to: 13, name: 'stop', mode: 'drone' },
  { from: 13, to: 20, name: 'tour_hops', mode: 'nervous' },
  { from: 20, to: 25, name: 'tour_site', mode: 'drone' },
  { from: 25, to: 34, name: 'tour_unplug', mode: 'drone' },
  { from: 34, to: 37, name: 'ipc_pc', mode: 'drone', focus: 'pc' },
  { from: 37, to: 42, name: 'tour_streams', mode: 'drone' },
  { from: 42, to: 50, name: 'tour_noise', mode: 'nervous' },
  { from: 50, to: 58, name: 'ipc_abenix', mode: 'drone' },
  { from: 58, to: 70, name: 'end', mode: 'orbit', focus: 'endcard' },
]

export const isTour = (name: string) => name === 'platform' || name.startsWith('tour_')

export const storyLength = () => {
  const st = useUi.getState().story
  if (st.loop) {
    const done = st.steps?.taken ?? st.steps?.nocmd
    return done !== undefined ? Math.ceil(done - st.t0 + 16) : Math.max(60, Math.ceil((useUi.getState().state?.t ?? 0) - st.t0 + 30))
  }
  return st.ipc ? 64 : 60
}

// the loop story waits on Abenix, so its beats come from the steps it has reached
function loopBeat(s: number): Beat {
  const st = useUi.getState().story
  const at = (k: string) => (st.steps?.[k] !== undefined ? st.steps[k] - st.t0 : undefined)
  const done = at('taken') ?? at('nocmd')
  if (done !== undefined && s >= done + 6) return { from: done + 6, to: done + 30, name: 'end', mode: 'orbit', focus: 'endcard' }
  // the person's decision and what came of it, on the whole ground station
  if (done !== undefined && s >= done) return { from: done, to: done + 6, name: 'tour_loop', mode: 'drone' }
  const asked = at('asked')
  if (asked !== undefined && s >= asked) return { from: asked, to: done ?? asked + 600, name: 'tour_phone', mode: 'drone' }
  const fired = at('fired')
  if (fired !== undefined && s >= fired) return { from: fired, to: (done ?? fired + 120) + 6, name: 'loop_run', mode: 'drone', focus: 'loop' }
  return { from: 0, to: fired ?? 3600, name: 'loop_build', mode: 'drone', focus: 'oil' }
}

export const beatAt = (s: number): Beat => {
  if (useUi.getState().story.loop) return loopBeat(s)
  const list = useUi.getState().story.ipc ? IPC_BEATS : BEATS
  return list.find((b) => s >= b.from && s < b.to) ?? list[list.length - 1]
}

const ease = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x))

function at(id: string): { x: number; y: number } {
  const m = hot.curr?.machines.find((x) => x.id === id)
  return m ? { x: m.x, y: m.y } : { x: 0, y: 0 }
}

function siteFocus(): { x: number; y: number } {
  const pit = hot.site?.pit
  if (!pit) return { x: -20, y: 0 }
  const xs = pit.map((p) => p[0]), ys = pit.map((p) => p[1])
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }
}

const clampSite = (v: number) => Math.max(-70, Math.min(70, v))
const tmp: Pose = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 40 }

// The middle of the work: pit, spoil and laydown together.
function workCentre(): { x: number; y: number } {
  const zs = hot.site?.zones.filter((z) => /excavation|spoil|laydown/.test(z.kind)) ?? []
  const pts = zs.flatMap((z) => z.polygon)
  if (!pts.length) return siteFocus()
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }
}

function orbitAround(out: Pose, c: { x: number; y: number }, r: number, h: number, ang: number, fov: number) {
  out.pos.set(c.x + Math.cos(ang) * r, h, -c.y + Math.sin(ang) * r)
  out.look.set(c.x, 0, -c.y)
  out.fov = fov
}

// On a real orthophoto the ground is a flat photograph, so every shot stays steep: near nadir or high angle,
// never the low oblique that would show the flatness.
function realShot(b: Beat, s: number, u: number, pose: Pose, t: number) {
  const c = workCentre()
  switch (b.name) {
    case 'hero': {
      const d = siteFocus()
      const k = ease((s - b.from) / 4.2)
      dronePose(pose, c.x - 10 + (d.x + 6 - c.x + 10) * k, c.y + 6 + (d.y - 4 - c.y - 6) * k, 175 - 45 * k, t, -76 - 10 * k, 46 - 4 * k)
      return true
    }
    case 'nervous':
      orbitAround(pose, c, 120 - u * 20, 165 - u * 15, 0.6 + u * 0.5, 50)
      pose.look.y = 20
      return true
    case 'aioff':
      dronePose(pose, c.x + 10, c.y - 4, 120 - u * 15, t, -88, 52)
      return true
    case 'autonomy':
      dronePose(pose, c.x + 8, c.y, 125, t, -86, 50)
      return true
    case 'end':
      orbitAround(pose, c, 58 + u * 6, 132 + u * 6, 2.1 + (s - b.from) * 0.025, 44)
      return true
  }
  return false
}

export function storyShot(s: number, pose: Pose, t: number): { name: string; mode: CamMode } {
  const b = beatAt(s)
  const u = ease((s - b.from) / (b.to - b.from))
  if (useUi.getState().realGround && realShot(b, s, u, pose, t)) return { name: b.name, mode: b.mode }
  switch (b.name) {
    case 'hero': {
      // a slow descending push-in: golden-hour oblique over the city, settling near nadir above the dig
      const d = siteFocus()
      const k = ease((s - b.from) / 4.2)
      orbitPose(pose, 175, 118, 2.32 + s * 0.012, new THREE.Vector3(0, 0, 0))
      dronePose(tmp, d.x + 6, d.y - 4, 150, t, -76, 42)
      pose.pos.lerp(tmp.pos, k)
      pose.look.lerp(tmp.look, k)
      pose.fov = 36 + (42 - 36) * k
      break
    }
    case 'stop': {
      const e = at('EX1')
      dronePose(pose, e.x + 1, e.y - 1, 118, t, -89.5, 26 - u * 6)
      break
    }
    case 'replan': {
      // the map sits left of the phone
      const e = at('EX1')
      dronePose(pose, e.x + 16, e.y - 2, 130, t, -89.5, 34)
      break
    }
    case 'nervous':
      orbitPose(pose, 230 - u * 30, 100 - u * 12, 0.6 + u * 0.5, new THREE.Vector3(0, 44, 0))
      pose.fov = 48
      break
    case 'gust': {
      const b0 = hot.site?.craneBases.find((c) => c.kind === 'tower') ?? { x: -20, y: 38 }
      dronePose(pose, b0.x + 14 - u * 4, b0.y - 12, 165, t, -84, 48)
      break
    }
    case 'platform': {
      // the operator's own view: EX1 and the pit, the inspector open beside it
      const e = at('EX1')
      dronePose(pose, e.x + 8, e.y + 4, 150, t, -89, 50)
      break
    }
    case 'aioff':
      dronePose(pose, 6, 0, 150 - u * 15, t)
      break
    case 'newmachine': {
      // the zoom lens tracks the new telehandler, held left of frame for the code panel
      const th = hot.curr?.machines.find((m) => /tele/i.test(m.kind))
      const x = clampSite((th?.x ?? 10) + 14), y = clampSite(th?.y ?? -60)
      dronePose(pose, x, y, 125, t, -84, 30)
      break
    }
    case 'autonomy':
      dronePose(pose, -18, 10, 150, t, -86, 44)
      break
    case 'loop_build':
    case 'loop_run':
    case 'tour_phone':
    case 'tour_loop': {
      // EX1 on the left, the card on the right
      const e = at('EX1')
      dronePose(pose, e.x + 14, e.y - 3, 122, t, -89, 34)
      break
    }
    case 'ipc_release':
    case 'ipc_abenix': {
      // EX1 back at work, with the trucks it loads
      const e = at('EX1')
      dronePose(pose, e.x + 4, e.y - 3, 125, t, -88, 36 - u * 4)
      break
    }
    case 'tour_site': {
      // every machine on the site with its IPC or SIM label
      const c = workCentre()
      dronePose(pose, c.x, c.y, 150, t, -89, 56)
      break
    }
    case 'tour_unplug':
    case 'tour_streams':
    case 'ipc_pc': {
      // EX1 left of frame, its card on the right
      const e = at('EX1')
      dronePose(pose, e.x + 12, e.y - 2, 120, t, -89, 34)
      break
    }
    case 'ipc_hops':
    case 'ipc_noise':
    case 'tour_hops':
    case 'tour_noise': {
      const e = at('EX1')
      orbitPose(pose, 120 - u * 20, 80 - u * 8, 0.9 + u * 0.4, new THREE.Vector3(e.x, 20, -e.y))
      pose.pos.x += e.x
      pose.pos.z -= e.y
      pose.fov = 46
      break
    }
    default:
      // the establishing shot: high oblique, slow orbit, the far blocks soft in the haze
      orbitPose(pose, 175 + u * 20, 118 + u * 10, 2.32 + (s - b.from) * 0.02, new THREE.Vector3(0, 0, 0))
      pose.fov = 36
  }
  return { name: b.name, mode: b.mode }
}

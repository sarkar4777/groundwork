import * as THREE from 'three'
import type { CamMode } from '../live/store'
import { hot } from '../live/hot'
import { dronePose, orbitPose } from '../scene/CameraRig'

interface Pose { pos: THREE.Vector3; look: THREE.Vector3; fov: number }

export type Focus = 'phone' | 'latency' | 'gust' | 'aioff' | 'code' | 'autonomy' | 'endcard'

export interface Beat { from: number; to: number; name: string; mode: CamMode; focus?: Focus }

// PLAN.md section 13 on the bff's story clock. capture.mjs cuts the kept part of each beat.
export const BEATS: Beat[] = [
  { from: 0, to: 4, name: 'hero', mode: 'drone' },
  { from: 4, to: 9, name: 'stop', mode: 'drone' },
  { from: 9, to: 14, name: 'replan', mode: 'drone', focus: 'phone' },
  { from: 14, to: 21, name: 'nervous', mode: 'nervous', focus: 'latency' },
  { from: 21, to: 28, name: 'gust', mode: 'drone', focus: 'gust' },
  { from: 28, to: 35, name: 'aioff', mode: 'drone', focus: 'aioff' },
  { from: 35, to: 44, name: 'newmachine', mode: 'drone', focus: 'code' },
  { from: 44, to: 52, name: 'autonomy', mode: 'drone', focus: 'autonomy' },
  { from: 52, to: 61, name: 'end', mode: 'orbit', focus: 'endcard' },
]

export const beatAt = (s: number): Beat => BEATS.find((b) => s >= b.from && s < b.to) ?? BEATS[BEATS.length - 1]

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

export function storyShot(s: number, pose: Pose, t: number): { name: string; mode: CamMode } {
  const b = beatAt(s)
  const u = ease((s - b.from) / (b.to - b.from))
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
    default:
      // the establishing shot: high oblique, slow orbit, the far blocks soft in the haze
      orbitPose(pose, 175 + u * 20, 118 + u * 10, 2.32 + (s - 52) * 0.02, new THREE.Vector3(0, 0, 0))
      pose.fov = 36
  }
  return { name: b.name, mode: b.mode }
}

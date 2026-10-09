import * as THREE from 'three'
import type { CamMode } from '../live/store'
import { hot } from '../live/hot'
import { cranePose, dronePose, machinePose, orbitPose } from '../scene/CameraRig'

interface Pose { pos: THREE.Vector3; look: THREE.Vector3; fov: number }

export interface Beat { from: number; to: number; name: string; mode: CamMode; focus?: 'pilot' | 'phone' | 'latency' | 'autonomy' | 'faults' | 'endcard' }

// PLAN.md section 13, the 60 second beat sheet.
export const BEATS: Beat[] = [
  { from: 0, to: 4, name: 'hero', mode: 'drone' },
  { from: 4, to: 9, name: 'stop', mode: 'drone' },
  { from: 9, to: 14, name: 'replan', mode: 'drone', focus: 'phone' },
  { from: 14, to: 21, name: 'nervous', mode: 'nervous', focus: 'latency' },
  { from: 21, to: 28, name: 'cab', mode: 'cab' },
  { from: 28, to: 35, name: 'aioff', mode: 'drone', focus: 'faults' },
  { from: 35, to: 44, name: 'newmachine', mode: 'follow' },
  { from: 44, to: 52, name: 'autonomy', mode: 'drone', focus: 'autonomy' },
  { from: 52, to: 61, name: 'end', mode: 'orbit', focus: 'endcard' },
]

export const beatAt = (s: number): Beat => BEATS.find((b) => s >= b.from && s < b.to) ?? BEATS[BEATS.length - 1]

const ease = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x))

function at(id: string): { x: number; y: number } {
  const m = hot.curr?.machines.find((x) => x.id === id)
  return m ? { x: m.x, y: m.y } : { x: 0, y: 0 }
}

export function storyShot(s: number, pose: Pose, t: number): { name: string; mode: CamMode } {
  const b = beatAt(s)
  const u = ease((s - b.from) / (b.to - b.from))
  switch (b.name) {
    case 'hero':
      dronePose(pose, -10 + u * 8, -30 + u * 10, 95 - u * 10, t, -38)
      break
    case 'stop': {
      const e = at('EX1')
      dronePose(pose, e.x + 2, e.y - 2, 62 - u * 18, t)
      break
    }
    case 'replan': {
      const e = at('EX1')
      dronePose(pose, e.x + 18 * u + 8, e.y - 6, 70 + u * 25, t)
      break
    }
    case 'nervous':
      orbitPose(pose, 210 - u * 30, 125 - u * 15, 0.6 + u * 0.5, new THREE.Vector3(0, 36, 0))
      pose.fov = 46
      break
    case 'cab':
      if (!cranePose(pose)) dronePose(pose, -14, -28, 80, t)
      break
    case 'aioff':
      dronePose(pose, 6, 0, 150 - u * 15, t)
      break
    case 'newmachine':
      if (!machinePose(hot.curr?.machines.find((m) => /tele/i.test(m.kind))?.id ?? 'TH1', 'follow', t, pose)) dronePose(pose, 10, -60, 80, t)
      break
    case 'autonomy':
      dronePose(pose, 30, 20, 120 + u * 15, t)
      break
    default:
      orbitPose(pose, 140 + u * 150, 50 + u * 130, 2.2 + u * 0.35, new THREE.Vector3(0, 6, 0))
      pose.fov = 40
  }
  return { name: b.name, mode: b.mode }
}

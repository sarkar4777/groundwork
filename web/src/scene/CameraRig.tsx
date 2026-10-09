import * as THREE from 'three'
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitImpl } from 'three-stdlib'
import { hot, interpAlpha, machineAt } from '../live/hot'
import { useUi, type CamMode } from '../live/store'
import type { Machine } from '../proto/types'
import { heightAt } from './ground/heights'
import { craneRig } from './machines/Cranes'
import { nervous } from './nervousState'
import { storyShot } from '../story/shots'

export const drone = { x: 4, y: -2, alt: 150, gimbal: -89.5, yaw: 0, flightStart: performance.now() }
export const camInfo = { alt: 120, pitch: -90, heading: 0, fov: 58 }

interface Pose {
  pos: THREE.Vector3
  look: THREE.Vector3
  fov: number
}

const scratch = { joints: {} } as Machine

function firstOf(kind: RegExp): string | null {
  return hot.curr?.machines.find((m) => kind.test(m.kind))?.id ?? null
}

export function machinePose(id: string | null, kind: 'follow' | 'seat', t: number, out: Pose): boolean {
  if (!id) return false
  const m = machineAt(id, scratch, interpAlpha())
  if (!m) return false
  const gz = heightAt(m.x, m.y)
  if (kind === 'follow') {
    const back = 27, up = 15
    const h = m.heading + 0.65 + Math.sin(t * 0.15) * 0.2
    out.pos.set(m.x - Math.cos(h) * back, gz + up, -(m.y - Math.sin(h) * back))
    out.look.set(m.x + Math.cos(m.heading) * 4, gz + 2, -(m.y + Math.sin(m.heading) * 4))
    out.fov = 42
    return true
  }
  const sw = m.heading + (m.joints.swing ?? 0)
  const cx = 0.35, cz = -0.85
  const ox = Math.cos(sw) * cx - Math.sin(sw) * -cz
  const oy = Math.sin(sw) * cx + Math.cos(sw) * -cz
  out.pos.set(m.x + ox, gz + 3.35, -(m.y + oy))
  out.look.set(m.x + ox + Math.cos(sw) * 10, gz + 0.5, -(m.y + oy + Math.sin(sw) * 10))
  out.fov = 68
  return true
}

export function cranePose(out: Pose): boolean {
  const id = [...craneRig.keys()].find((k) => /^TC|tower/i.test(k)) ?? [...craneRig.keys()][0]
  const r = id ? craneRig.get(id) : null
  if (!r || !r.cab) return false
  r.cab.getWorldPosition(out.pos)
  out.look.copy(r.hook)
  out.look.y = Math.max(0, r.hook.y - 6)
  out.fov = 64
  return true
}

export function dronePose(out: Pose, x: number, y: number, alt: number, t: number, gimbalDeg = -89.5) {
  const dx = Math.sin(t * 0.21) * 0.9 + Math.sin(t * 0.53) * 0.3
  const dy = Math.cos(t * 0.17) * 0.9 + Math.sin(t * 0.41) * 0.3
  const gz = heightAt(x, y)
  const tilt = ((90 + gimbalDeg) * Math.PI) / 180
  const back = Math.tan(tilt) * alt
  out.pos.set(x + dx, alt + gz + Math.sin(t * 0.3) * 0.4, -(y + dy) + back + 0.4)
  out.look.set(x + dx * 0.98, gz, -(y + dy))
  out.fov = 58
}

export function orbitPose(out: Pose, r: number, h: number, ang: number, look = new THREE.Vector3(0, 0, 0)) {
  out.pos.set(Math.cos(ang) * r, h, Math.sin(ang) * r)
  out.look.copy(look)
  out.fov = 40
}

export function CameraRig() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const gl = useThree((s) => s.gl)
  const controls = useRef<OrbitImpl>(null!)
  const pose = useMemo<Pose>(() => ({ pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 58 }), [])
  const cur = useMemo<Pose>(() => ({ pos: new THREE.Vector3(0, 120, 1), look: new THREE.Vector3(), fov: 58 }), [])
  const blend = useRef(1)
  const lastMode = useRef<CamMode>('drone')
  const lastShot = useRef('')
  const orbitArmed = useRef(false)

  // drone feed: wheel changes altitude, drag pans the aircraft
  useEffect(() => {
    const el = gl.domElement
    let drag: { x: number; y: number; dx: number; dy: number } | null = null
    const onWheel = (e: WheelEvent) => {
      if (useUi.getState().cam !== 'drone' || useUi.getState().story.running) return
      e.preventDefault()
      drone.alt = THREE.MathUtils.clamp(drone.alt * (1 + Math.sign(e.deltaY) * 0.08), 35, 220)
    }
    const onDown = (e: PointerEvent) => {
      if (useUi.getState().cam !== 'drone') return
      drag = { x: e.clientX, y: e.clientY, dx: drone.x, dy: drone.y }
    }
    const onMove = (e: PointerEvent) => {
      if (!drag) return
      const mpp = (2 * drone.alt * Math.tan((camInfo.fov * Math.PI) / 360)) / el.clientHeight
      drone.x = THREE.MathUtils.clamp(drag.dx - (e.clientX - drag.x) * mpp, -140, 140)
      drone.y = THREE.MathUtils.clamp(drag.dy + (e.clientY - drag.y) * mpp, -140, 140)
    }
    const onUp = () => (drag = null)
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [gl])

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    const ui = useUi.getState()
    let mode: CamMode = ui.cam
    let cut = false

    if (ui.story.running && hot.curr) {
      const s = hot.curr.t + (performance.now() - hot.currAt) / 1000 - ui.story.t0
      const shot = storyShot(s, pose, t)
      if (shot.name !== lastShot.current) {
        cut = true
        lastShot.current = shot.name
        if (ui.cam !== shot.mode) useUi.setState({ cam: shot.mode })
      }
      mode = shot.mode
    } else {
      lastShot.current = ''
      if (mode !== lastMode.current) {
        blend.current = 0
        orbitArmed.current = false
      }
      const sel = ui.selected
      let ok = true
      switch (mode) {
        case 'drone':
          dronePose(pose, drone.x, drone.y, drone.alt, t)
          break
        case 'orbit':
          if (!orbitArmed.current) orbitPose(pose, 150, 85, 0.9)
          break
        case 'follow':
          ok = machinePose(sel && hot.curr?.machines.some((m) => m.id === sel && !/crane/.test(m.kind)) ? sel : firstOf(/excav/), 'follow', t, pose)
          break
        case 'seat':
          ok = machinePose(sel && hot.curr?.machines.some((m) => m.id === sel && /excav/.test(m.kind)) ? sel : firstOf(/excav/), 'seat', t, pose)
          break
        case 'cab':
          ok = cranePose(pose)
          break
        case 'nervous':
          orbitPose(pose, 215, 92, 0.75 + t * 0.03, new THREE.Vector3(0, 44, 0))
          pose.fov = 48
          break
      }
      if (!ok) dronePose(pose, drone.x, drone.y, drone.alt, t)
    }
    lastMode.current = mode

    nervous.k += ((mode === 'nervous' ? 1 : 0) - nervous.k) * Math.min(1, dt * 2.5)
    if (Math.abs(nervous.k - (mode === 'nervous' ? 1 : 0)) < 0.002) nervous.k = mode === 'nervous' ? 1 : 0

    const orbitLive = mode === 'orbit' && !ui.story.running && orbitArmed.current
    if (controls.current) controls.current.enabled = orbitLive
    if (orbitLive) {
      controls.current.update()
    } else {
      if (cut) blend.current = 1
      blend.current = Math.min(1, blend.current + dt * 0.9)
      const smooth = cut ? 1 : mode === 'cab' || mode === 'seat' || mode === 'follow' ? Math.min(1, dt * (2 + blend.current * 10)) : Math.min(1, dt * (1.5 + blend.current * 6))
      cur.pos.lerp(pose.pos, smooth)
      cur.look.lerp(pose.look, smooth)
      cur.fov += (pose.fov - cur.fov) * smooth
      camera.position.copy(cur.pos)
      camera.lookAt(cur.look)
      if (Math.abs(camera.fov - cur.fov) > 0.01) {
        camera.fov = cur.fov
        camera.updateProjectionMatrix()
      }
      if (mode === 'orbit' && !ui.story.running && cur.pos.distanceTo(pose.pos) < 1) {
        orbitArmed.current = true
        controls.current?.target.copy(cur.look)
      }
    }

    const dir = new THREE.Vector3()
    camera.getWorldDirection(dir)
    camInfo.pitch = (Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)) * 180) / Math.PI
    let hdg = (Math.atan2(dir.x, -dir.z) * 180) / Math.PI
    if (camInfo.pitch < -85) hdg = 0
    camInfo.heading = (hdg + 360) % 360
    camInfo.alt = camera.position.y - heightAt(camera.position.x, -camera.position.z)
    camInfo.fov = camera.fov
  })

  return <OrbitControls ref={controls} enabled={false} enableDamping dampingFactor={0.08} maxPolarAngle={Math.PI * 0.47} minDistance={12} maxDistance={420} makeDefault={false} />
}

import * as THREE from 'three'
import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { hot, interpAlpha, machineAt, workerAt } from '../live/hot'
import type { Machine } from '../proto/types'
import { heightAt } from './ground/heights'
import { CORE, SAFETY_Y } from './Nervous'
import { craneRig, TOWER } from './machines/Cranes'
import { useUi } from '../live/store'

export const labelEls = new Map<string, HTMLElement>()

const lift: Record<string, number> = { excavator: 5.5, haul: 5, truck: 5, dozer: 4.5, roller: 4.5, tele: 4.5, pil: 27, drone: 3, mobile: 6 }

function liftFor(kind: string) {
  for (const k in lift) if (kind.includes(k)) return lift[k]
  return 5
}

export function LabelProjector() {
  const v = useMemo(() => new THREE.Vector3(), [])
  const m = useMemo(() => ({ joints: {} }) as Machine, [])
  useFrame(({ camera, size }) => {
    const k = interpAlpha()
    const drone = useUi.getState().cam === 'drone'
    labelEls.forEach((el, key) => {
      let ok = false
      if (key.startsWith('m:')) {
        const id = key.slice(2)
        const rig = craneRig.get(id)
        if (rig && /tower|TC/i.test(id)) {
          v.copy(rig.base)
          v.y += drone ? TOWER.mast * 0.4 : TOWER.mast + 6
          ok = true
        } else if (machineAt(id, m, k)) {
          const air = m.kind.includes('drone')
          v.set(m.x, heightAt(m.x, m.y) + (air ? Math.max(8, m.z) + 3 : liftFor(m.kind)), -m.y)
          ok = true
        }
      } else if (key.startsWith('w:')) {
        const w = workerAt(key.slice(2), k)
        if (w) {
          v.set(w.x, heightAt(w.x, w.y) + 2.2, -w.y)
          ok = true
        }
      } else if (key === 'core') {
        v.copy(CORE)
        v.y -= 20
        ok = true
      } else if (key === 'safety') {
        v.set(0, SAFETY_Y, 112)
        ok = true
      } else if (key.startsWith('stop:')) {
        const id = key.slice(5)
        if (machineAt(id, m, k)) {
          v.set(m.x, heightAt(m.x, m.y) + 3, -m.y)
          ok = true
        }
      }
      if (ok) {
        v.project(camera)
        ok = v.z < 1 && v.x > -1.2 && v.x < 1.2 && v.y > -1.2 && v.y < 1.2
      }
      if (!ok) {
        if (el.style.visibility !== 'hidden') el.style.visibility = 'hidden'
        return
      }
      const x = ((v.x + 1) / 2) * size.width
      const y = ((1 - v.y) / 2) * size.height
      el.style.visibility = 'visible'
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
    })
    void hot
  })
  return null
}

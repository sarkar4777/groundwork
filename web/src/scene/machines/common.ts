import * as THREE from 'three'
import { useMemo, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { interpAlpha, machineAt } from '../../live/hot'
import type { Machine } from '../../proto/types'
import { heightAt } from '../ground/heights'

const fwd = new THREE.Vector3()

// Places a machine group from the interpolated twin state and settles it on the ground.
export function useMachineDrive(id: string, ref: RefObject<THREE.Group>, len: number, wid: number, fn?: (m: Machine, dt: number) => void, air = false) {
  const scratch = useMemo(() => ({ joints: {} }) as Machine, [])
  useFrame((_, dt) => {
    const g = ref.current
    if (!g) return
    const m = machineAt(id, scratch, interpAlpha())
    if (!m) {
      g.visible = false
      return
    }
    g.visible = true
    g.rotation.order = 'YZX'
    if (air) {
      g.position.set(m.x, heightAt(m.x, m.y) + Math.max(m.z, 8), -m.y)
      g.rotation.set(0, m.heading, 0)
    } else {
      const c = Math.cos(m.heading), s = Math.sin(m.heading)
      const hx = len / 2, hw = wid / 2
      const hF = heightAt(m.x + c * hx, m.y + s * hx)
      const hB = heightAt(m.x - c * hx, m.y - s * hx)
      const hL = heightAt(m.x - s * hw, m.y + c * hw)
      const hR = heightAt(m.x + s * hw, m.y - c * hw)
      const h0 = heightAt(m.x, m.y)
      g.position.set(m.x, Math.max(h0, (hF + hB) / 2), -m.y)
      g.rotation.set(-Math.atan2(hR - hL, wid), m.heading, Math.atan2(hF - hB, len))
    }
    fwd.set(1, 0, 0)
    fn?.(m, dt)
  })
}

export const isKind = (kind: string) => {
  const k = kind.toLowerCase()
  if (k.includes('excav')) return 'excavator'
  if (k.includes('dozer')) return 'dozer'
  if (k.includes('truck') || k.includes('haul') || k.includes('adt')) return 'truck'
  if (k.includes('tower')) return 'tower'
  if (k.includes('mobile')) return 'mobile'
  if (k.includes('pil')) return 'piling'
  if (k.includes('roll') || k.includes('compact')) return 'roller'
  if (k.includes('tele')) return 'telehandler'
  if (k.includes('drone') || k.includes('uav')) return 'drone'
  return 'other'
}

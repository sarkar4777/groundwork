import * as THREE from 'three'
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { hot, interpAlpha, machineAt, workerAt } from '../live/hot'
import type { Machine } from '../proto/types'
import { heightAt } from './ground/heights'
import { isKind } from './machines/common'
import { nervous } from './nervousState'

const FOOT: Record<string, [number, number]> = {
  excavator: [6.4, 4.6], truck: [11.5, 3.9], dozer: [5.4, 4.4], roller: [6.4, 3], piling: [6.6, 4.8],
  telehandler: [6.2, 3.2], tower: [8, 8], mobile: [14, 8.5], other: [5, 3],
}

// Soft ambient occlusion under every machine and person, so nothing floats above the ground.
export function ContactShadows() {
  const ref = useRef<THREE.InstancedMesh>(null!)
  const tex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const g = c.getContext('2d')!
    const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64)
    grd.addColorStop(0, 'rgba(0,0,0,0.9)')
    grd.addColorStop(0.45, 'rgba(0,0,0,0.55)')
    grd.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grd
    g.fillRect(0, 0, 128, 128)
    const t = new THREE.CanvasTexture(c)
    return t
  }, [])
  const mat = useMemo(
    () => new THREE.MeshBasicMaterial({ map: tex, color: '#120c08', transparent: true, opacity: 0.62, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, toneMapped: false }),
    [tex],
  )
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1)
    g.rotateX(-Math.PI / 2)
    return g
  }, [])
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), ms: { joints: {} } as Machine }), [])
  useFrame(() => {
    const mesh = ref.current
    if (!mesh || !hot.curr) return
    mat.opacity = 0.62 * (1 - nervous.k)
    const k = interpAlpha()
    let n = 0
    for (const c of hot.curr.machines) {
      if (n >= 60) break
      const kind = isKind(c.kind)
      if (kind === 'drone') continue
      const m = machineAt(c.id, tmp.ms, k)
      if (!m) continue
      const [l, w] = FOOT[kind] ?? FOOT.other
      tmp.p.set(m.x, heightAt(m.x, m.y) + 0.05, -m.y)
      tmp.q.setFromAxisAngle(tmp.up, kind === 'tower' ? 0 : m.heading)
      tmp.s.set(l * 1.25, 1, w * 1.35)
      mesh.setMatrixAt(n++, tmp.m.compose(tmp.p, tmp.q, tmp.s))
    }
    for (const wk of hot.curr.workers) {
      if (n >= 60) break
      const w = workerAt(wk.id, k)
      if (!w) continue
      tmp.p.set(w.x, heightAt(w.x, w.y) + 0.04, -w.y)
      tmp.q.identity()
      tmp.s.set(1.3, 1, 1.3)
      mesh.setMatrixAt(n++, tmp.m.compose(tmp.p, tmp.q, tmp.s))
    }
    mesh.count = n
    mesh.instanceMatrix.needsUpdate = true
  })
  return <instancedMesh ref={ref} args={[geo, mat, 60]} frustumCulled={false} renderOrder={1} />
}

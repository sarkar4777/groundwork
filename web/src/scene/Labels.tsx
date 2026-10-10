import * as THREE from 'three'
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { interpAlpha, machineAt, workerAt } from '../live/hot'
import type { Machine } from '../proto/types'
import { heightAt } from './ground/heights'
import { CORE, SAFETY_Y } from './Nervous'
import { craneRig, TOWER } from './machines/Cranes'
import { useUi } from '../live/store'
import { distortNdc } from './LensEffect'

export const labelEls = new Map<string, HTMLElement>()

const lift: Record<string, number> = { excavator: 5.5, haul: 5, truck: 5, dozer: 4.5, roller: 4.5, tele: 4.5, pil: 27, drone: 3, mobile: 6 }

function liftFor(kind: string) {
  for (const k in lift) if (kind.includes(k)) return lift[k]
  return 5
}

interface Item { key: string; el: HTMLElement; x: number; y: number; prio: number; w: number; h: number }

const sizes = new Map<string, { w: number; h: number; at: number }>()

function measure(key: string, el: HTMLElement, frame: number) {
  const c = sizes.get(key)
  if (c && frame - c.at < 20) return c
  const inner = el.firstElementChild as HTMLElement | null
  const s = { w: inner?.offsetWidth || 40, h: inner?.offsetHeight || 16, at: frame }
  sizes.set(key, s)
  return s
}

function priority(key: string, el: HTMLElement, selected: string | null): number {
  if (key.startsWith('stop:') || key === 'core' || key === 'safety') return 100
  if (key === 'm:' + selected) return 90
  if (key.startsWith('w:')) return el.dataset.zone === 'danger' ? 85 : el.dataset.zone === 'warn' ? 70 : 10
  if (key.startsWith('m:')) return el.dataset.state === 'alert' ? 75 : 40
  return 20
}

type Rect = { x0: number; y0: number; x1: number; y1: number }
const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0

// Projects every tag, then lays them out so none overlap: higher priority first, the rest
// stack upwards on a leader line, and what still does not fit folds into a +n chip.
export function LabelProjector() {
  const v = useMemo(() => new THREE.Vector3(), [])
  const m = useMemo(() => ({ joints: {} }) as Machine, [])
  const frame = useRef(0)
  useFrame(({ camera, size: vs }) => {
    frame.current++
    const k = interpAlpha()
    const ui = useUi.getState()
    const drone = ui.cam === 'drone'
    const items: Item[] = []
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
        distortNdc(v)
        ok = v.z < 1 && v.x > -1.1 && v.x < 1.1 && v.y > -1.1 && v.y < 1.15
      }
      if (!ok) {
        if (el.style.visibility !== 'hidden') el.style.visibility = 'hidden'
        return
      }
      const s = measure(key, el, frame.current)
      items.push({ key, el, x: ((v.x + 1) / 2) * vs.width, y: ((1 - v.y) / 2) * vs.height, prio: priority(key, el, ui.selected), w: s.w, h: s.h })
    })

    items.sort((a, b) => b.prio - a.prio || a.y - b.y)
    const placed: (Rect & { it: Item; more: number })[] = []
    const gap = 3
    for (const it of items) {
      let dy = 0
      let done = false
      for (let step = 0; step < 4 && !done; step++) {
        dy = -step * (it.h + gap)
        const r = { x0: it.x - it.w / 2 - 2, x1: it.x + it.w / 2 + 2, y1: it.y - 6 + dy, y0: it.y - 6 + dy - it.h }
        if (!placed.some((p) => overlaps(p, r))) {
          placed.push({ ...r, it, more: 0 })
          done = true
        }
      }
      const el = it.el
      if (!done) {
        el.style.visibility = 'hidden'
        let best: (typeof placed)[0] | null = null
        let bd = 1e9
        for (const p of placed) {
          const d = Math.hypot((p.x0 + p.x1) / 2 - it.x, p.y1 - it.y)
          if (d < bd && p.it.prio < 100) {
            bd = d
            best = p
          }
        }
        if (best) best.more++
        continue
      }
      el.style.visibility = 'visible'
      el.style.transform = `translate3d(${it.x.toFixed(1)}px, ${(it.y + dy).toFixed(1)}px, 0)`
      const lead = String(Math.round(-dy))
      if (el.dataset.lead !== lead) {
        el.dataset.lead = lead
        el.style.setProperty('--lead', `${lead}px`)
        el.classList.toggle('led', lead !== '0')
      }
    }
    for (const p of placed) {
      const more = p.more ? `+${p.more}` : ''
      if ((p.it.el.dataset.more ?? '') !== more) {
        p.it.el.dataset.more = more
        const chip = p.it.el.querySelector<HTMLElement>('.more')
        if (chip) {
          chip.textContent = more
          chip.title = more ? `${p.more} more tags here, zoom in to see them` : ''
        }
      }
    }
  })
  return null
}

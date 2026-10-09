import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useUi, type CaptionLog } from '../live/store'
import { hot } from '../live/hot'
import { approve, stopStory } from '../live/client'
import { beatAt } from './shots'
import { Autonomy, FaultDeck, LatencyStrip, PhoneApprovals, SitePilot } from '../panels/Panels'
import { Icon } from '../ui/kit'

// Numbers with their units read in amber, the rest stays white.
export function highlight(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\d+(?:[.,]\d+)?\s?(?:ms|m\/s|km\/h|m3|%|s\b|t\b|times)?)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(<b key={i++}>{m[0]}</b>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function simNow() {
  return hot.curr ? hot.curr.t + (performance.now() - hot.currAt) / 1000 : 0
}

export function Captions() {
  const cap = useUi((s) => s.caption)
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 200)
    return () => clearInterval(id)
  }, [])
  if (!cap) return null
  const now = simNow()
  if (now > cap.until + 0.05 || now < cap.t - 1) return null
  const lines = cap.text.split('\n').slice(0, 2).join('\n')
  return (
    <div className="captions" aria-live="polite">
      <div className="caption" key={cap.t}>{highlight(lines)}</div>
    </div>
  )
}

function srtTime(s: number) {
  const ms = Math.max(0, Math.round(s * 1000))
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), sec = Math.floor((ms % 60000) / 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`
}

export function toSrt(log: CaptionLog[], t0: number): string {
  return log
    .slice()
    .sort((a, b) => a.t - b.t)
    .map((c, i) => `${i + 1}\n${srtTime(c.t - t0)} --> ${srtTime(c.until - t0)}\n${c.text.split('\n').slice(0, 2).join('\n')}\n`)
    .join('\n')
}

export function downloadSrt() {
  const s = useUi.getState()
  if (!s.captionLog.length) return false
  const blob = new Blob([toSrt(s.captionLog, s.story.t0)], { type: 'application/x-subrip' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'groundwork-story.srt'
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  return true
}

;(window as unknown as { __gwSrt: () => string }).__gwSrt = () => {
  const s = useUi.getState()
  return toSrt(s.captionLog, s.story.t0)
}

export function StoryLayer() {
  const running = useUi((s) => s.story.running)
  const t0 = useUi((s) => s.story.t0)
  const [s, setS] = useState(0)
  const tapped = useRef(false)
  const [tap, setTap] = useState(false)
  useEffect(() => {
    if (!running) {
      tapped.current = false
      return
    }
    const id = setInterval(() => setS(simNow() - useUi.getState().story.t0), 100)
    return () => clearInterval(id)
  }, [running, t0])
  useEffect(() => {
    if (!running || tapped.current || s < 11.6) return
    const p = useUi.getState().approvals.find((a) => a.status === 'pending')
    if (!p) return
    tapped.current = true
    setTap(true)
    setTimeout(() => approve(p, 'approve'), 420)
    setTimeout(() => setTap(false), 1200)
  }, [s, running])
  if (!running) return null
  const beat = beatAt(s)
  const f = beat.focus
  return (
    <>
      <div className="story-chip glass">
        STORY {Math.max(0, Math.min(60, s)).toFixed(0).padStart(2, '0')} / 60
        <span className="story-progress"><i style={{ width: `${Math.min(100, (s / 60) * 100)}%` }} /></span>
        <button className="btn sm" onClick={stopStory} aria-label="Stop the story"><Icon name="stop" /></button>
      </div>
      {(beat.name === 'replan' || f === 'phone') && (
        <div className="story-float left" key="pilot"><SitePilot focus /></div>
      )}
      {f === 'phone' && <div className="story-float right" key="phone"><PhoneApprovals focus tap={tap} /></div>}
      {f === 'latency' && <div className="story-float bottomc" key="lat"><LatencyStrip focus /></div>}
      {f === 'faults' && <div className="story-float right" key="faults"><FaultDeck focus /></div>}
      {f === 'autonomy' && <div className="story-float right" key="auto"><Autonomy focus /></div>}
      {f === 'endcard' && s > 53 && (
        <div className="endcard">
          <div className="inner">
            <h1>Groundwork</h1>
            <p>Built on Abenix, open source.</p>
            <div className="tag">NORTHGATE YARD · MIT LICENCE</div>
          </div>
        </div>
      )}
    </>
  )
}

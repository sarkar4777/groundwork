#!/usr/bin/env node
// Renders the story film and takes the post screenshots from the running web app.
//
//   node scripts/capture.mjs                      render both films from .run/take.json, web on 5710
//   node scripts/capture.mjs --retake             record a fresh live take first (bff on 8710)
//   node scripts/capture.mjs --sizes 1920x1080    one size only
//   node scripts/capture.mjs --shots-only         live story screenshots, no film
//   node scripts/capture.mjs --replay             synthesised frames, everything is marked REPLAY
//   node scripts/capture.mjs --proof --sizes 1920x1080   the real-imagery proof clip, see docs/real-imagery.md
//   node scripts/capture.mjs --real                       the story on real ground, from .run/take-real.json
//
// The film is one live take (scripts/record-take.mjs) played back on a virtual clock. Each frame
// is stepped exactly 1/60 s, drawn, then screenshotted, so the video has no dropped or doubled frames.

import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync, rmSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'web', 'package.json'))
const { chromium } = require('playwright')

const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const opt = (n, d) => {
  const i = args.indexOf(n)
  return i >= 0 && args[i + 1] ? args[i + 1] : d
}

const WEB = opt('--url', process.env.GW_WEB_URL || 'http://localhost:5710')
const REPLAY = flag('--replay')
const SIZES = opt('--sizes', '1920x1080,1080x1350').split(',').map((s) => s.split('x').map(Number))
const OUT = opt('--out', join(root, 'docs'))
const SHOTS = join(OUT, 'screenshots')
const MEDIA = join(OUT, 'media')
const FPS = 60
const VIDEO = !flag('--shots-only')

mkdirSync(SHOTS, { recursive: true })
mkdirSync(MEDIA, { recursive: true })

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0
const url = `${WEB}/?capture=1${REPLAY ? '&replay=1' : ''}`
const log = (...a) => console.log('[capture]', ...a)

async function open(browser, w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => log('page error:', e.message))
  await page.goto(url)
  const deadline = Date.now() + 60000
  for (;;) {
    const st = await page.evaluate(() => window.__gw?.status())
    if (st?.hasState && st.terrain && st.site) break
    if (Date.now() > deadline) throw new Error(`no live frames from ${url}. Start the sim with scripts/dev.sh, or pass --replay`)
    await page.waitForTimeout(500)
  }
  await page.waitForTimeout(4000)
  return page
}

const storyT = (page) => page.evaluate(() => window.__gw.status().storyT)

async function waitStory(page, t) {
  for (;;) {
    const s = await storyT(page)
    if (s === null) throw new Error('story stopped early')
    if (s >= t) return
    await page.waitForTimeout(Math.min(200, Math.max(16, (t - s) * 1000 - 30)))
  }
}

async function shot(page, name, selector) {
  const path = join(SHOTS, name)
  if (selector) await page.locator(selector).first().screenshot({ path })
  else await page.screenshot({ path })
  log('saved', path)
}

// The cut: the part of each beat on the bff's story clock that goes into the video, in order.
// Cutting inside beats keeps every join a clean hard cut and the film under 60 s.
const EDIT = [
  [0, 4],
  [4, 9],
  [9.4, 14],
  [15, 20],
  [22, 27],
  [28.5, 32.1],
  [32.1, 46.5],
  [46.5, 51.1],
  [51.1, 55.6],
  [55.6, 59.8],
]

const BS = String.fromCharCode(92)

// The film on the virtual clock: the opening title over the running site, then the story cut,
// in story seconds. The end card runs on past the story's own 60 s.
const OPENING = [1.0, 6.3]
// a beat that changes the layout starts a few frames in, the 3D view takes three frames to resize
const FILM = [
  [0.3, 4],
  [4.05, 9],
  [9.4, 14],
  [15, 20],
  [22, 27],
  [28.5, 32.1],
  [32.17, 46.5],
  [46.6, 51.1],
  [51.15, 55.6],
  [55.6, 65.05],
]
const REAL = flag('--real')
// --real renders the same story on the real-site layout, from a take recorded with record-take.mjs --site nh108
const TAKE = opt('--take', join(root, '.run', REAL ? 'take-real.json' : 'take.json'))

async function renderFilm(browser, w, h, film = {}) {
  const take = film.take ?? TAKE
  const name = film.name ?? 'groundwork-story'
  const tag = `${w}x${h}`
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  page.on('pageerror', (e) => log('page error:', e.message))
  page.on('console', (m) => m.type() === 'error' && log('console:', m.text().slice(0, 200)))
  await page.route('**/__take.json', (r) => r.fulfill({ path: take, contentType: 'application/json' }))
  await page.clock.install({ time: Date.now() })
  await page.goto(`${WEB}/${film.page ?? ''}?capture=1&playback=1&render=1`)
  await page.waitForFunction(() => window.__gw?.timeline()?.ready && window.__gwStep, null, { timeout: 60000 })
  for (let i = 1; ; i++) {
    try {
      await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 500 * i)
      break
    } catch (e) {
      if (i >= 5) throw e
    }
  }

  const flush = () =>
    page.evaluate(async () => {
      const mc = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0) })
      await mc()
      await mc()
      window.__gwStep()
      window.__gw.frame()
      await mc()
      return document.querySelector('.caption:not(.off)')?.innerText?.trim() ?? ''
    })
  // the scene builds and its shaders compile on a still site before the clock starts
  for (let i = 0; i < (REAL ? 160 : 90); i++) {
    await page.clock.runFor(17)
    await flush()
    await page.waitForTimeout(i < 30 ? 120 : 30)
  }
  const st = await page.evaluate(() => window.__gw.status())
  if (!st.hasState || !st.terrain || !st.site) throw new Error(`playback did not build the site: ${JSON.stringify(st)}`)
  const tl = await page.evaluate(() => window.__gw.timeline())
  log(tag, `take loaded, story at ${tl.storyV.toFixed(2)} s, ends ${tl.endV.toFixed(2)} s on the virtual clock`)
  const base = await page.evaluate(() => {
    window.__gw.go()
    return performance.now()
  })

  const spans = film.spans ?? [OPENING, ...FILM.map(([a, b]) => [tl.storyV + a, tl.storyV + b])]
  const endV = spans[spans.length - 1][1]
  if (endV > tl.endV + 0.5) throw new Error(`the take ends at ${tl.endV.toFixed(1)} s, the film needs ${endV.toFixed(1)} s`)
  const mp4 = join(MEDIA, `${name}-${tag}.mp4`)
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', mp4], { stdio: ['pipe', 'inherit', 'inherit'] })
  const done = new Promise((res) => ff.on('close', res))
  const cdp = await context.newCDPSession(page)
  const write = (buf) => (ff.stdin.write(buf) ? null : new Promise((r) => ff.stdin.once('drain', r)))

  const caps = []
  let k = 0
  let ms = 0
  let shot = 0
  const t0 = Date.now()
  for (;;) {
    k++
    // the page sees the exact frame time, the timers run on the nearest whole millisecond
    const v = k / FPS
    await page.evaluate((t) => window.__gwNow(t), base + v * 1000)
    const target = Math.round(v * 1000)
    await page.clock.runFor(target - ms)
    ms = target
    if (v >= endV) break
    const cap = await flush()
    if (!spans.some(([a, b]) => v >= a && v < b)) continue
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92 })
    await write(Buffer.from(data, 'base64'))
    caps.push(v >= tl.storyV + FILM[FILM.length - 1][0] ? '' : cap)
    shot++
    if (shot % 600 === 0) log(tag, `${(shot / FPS).toFixed(0)} s rendered, ${((Date.now() - t0) / 1000).toFixed(0)} s so far`)
  }
  ff.stdin.end()
  const code = await done
  if (code !== 0) throw new Error('ffmpeg failed')

  // subtitles come off the same frames, so they line up to the frame
  const cues = []
  caps.forEach((text, i) => {
    const last = cues[cues.length - 1]
    if (last && last.text === text && last.end === i) last.end = i + 1
    else if (text) cues.push({ text, start: i, end: i + 1 })
  })
  const srtPath = join(MEDIA, `${name}-${tag}.srt`)
  if (!film.spans) writeFileSync(srtPath, cues.map((c, i) => `${i + 1}\n${srtTime(c.start / FPS)} --> ${srtTime(c.end / FPS)}\n${c.text}\n`).join('\n'))
  log(tag, `video ${mp4}: ${shot} frames, ${(shot / FPS).toFixed(2)} s at ${FPS} fps, ${(statSync(mp4).size / 1e6).toFixed(1)} MB, ${cues.length} cues, rendered in ${((Date.now() - t0) / 60000).toFixed(1)} min`)
  await context.close()
}

const srtTime = (s) => {
  const ms = Math.max(0, Math.round(s * 1000))
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`
}

async function recordStory(page, tag, withShots) {
  const cdp = await page.context().newCDPSession(page)
  const dir = join(MEDIA, `frames-${tag}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const frames = []
  let recording = false
  cdp.on('Page.screencastFrame', async (f) => {
    if (recording) {
      const file = join(dir, `${String(frames.length).padStart(5, '0')}.jpg`)
      writeFileSync(file, Buffer.from(f.data, 'base64'))
      frames.push({ file, ts: f.metadata.timestamp })
    }
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
  })
  if (hasFfmpeg && VIDEO) {
    const { w, h } = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }))
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: w, maxHeight: h, everyNthFrame: 1 })
  }
  const ok = await page.evaluate(() => window.__gw.startStory())
  if (!ok) throw new Error('POST /story/start failed')
  // wait for the bff's own story clock to restart, so the take starts at its first frame
  for (let i = 0; i < 100; i++) {
    const st = await page.evaluate(() => window.__gw.status())
    if (st.story && st.storyT !== null && st.storyT < 2) break
    await page.waitForTimeout(100)
  }
  recording = true
  // story clock against wall clock, and the caption on screen at each moment
  const clock = []
  let polling = true
  const pollLoop = (async () => {
    while (polling) {
      const r = await page.evaluate(() => ({ s: window.__gw.status().storyT, c: document.querySelector('.caption:not(.off)')?.innerText ?? '' })).catch(() => null)
      if (r && r.s !== null) clock.push({ wall: Date.now() / 1000, s: r.s, c: r.c })
      await new Promise((res) => setTimeout(res, 80))
    }
  })()
  log(tag, 'story running')

  if (withShots) {
    const clean = (on) => page.evaluate((v) => window.__gw.clean(v), on)
    await waitStory(page, 1.3)
    await clean(true)
    await shot(page, '01-hero.png')
    await clean(false)
    await waitStory(page, 6.6)
    await shot(page, '03-safety-stop.png')
    await waitStory(page, 11.2)
    await shot(page, '05-phone-approval.png', '.sc-phone .phone')
    await waitStory(page, 17.5)
    await clean(true)
    await shot(page, '02-nervous-system.png')
    await clean(false)
    await waitStory(page, 53.5)
    await shot(page, '08-earned-autonomy.png', '.sc-auto')
  }

  for (;;) {
    const st = await page.evaluate(() => window.__gw.status())
    if (!st.story || (st.storyT ?? 0) > EDIT[EDIT.length - 1][1] + 1) break
    await page.waitForTimeout(250)
  }
  recording = false
  polling = false
  await pollLoop
  if (hasFfmpeg && VIDEO) await cdp.send('Page.stopScreencast')

  // story seconds to wall seconds, by linear interpolation over the samples
  const wallAt = (s) => {
    let i = clock.findIndex((c) => c.s >= s)
    if (i <= 0) i = 1
    if (i >= clock.length) i = clock.length - 1
    const a = clock[i - 1], b = clock[i]
    return a.wall + ((s - a.s) / Math.max(1e-3, b.s - a.s)) * (b.wall - a.wall)
  }
  const captionAt = (s) => {
    let best = clock[0]
    for (const c of clock) if (Math.abs(c.s - s) < Math.abs(best.s - s)) best = c
    return best?.c?.trim() ?? ''
  }

  const cues = []
  let out = 0
  for (const [a, b] of EDIT) {
    // the title card carries the last line, so it gets no cue
    const final = a === EDIT[EDIT.length - 1][0]
    for (let x = a; x < b - 1e-6; x += 0.2) {
      const step = Math.min(0.2, b - x)
      const text = final ? '' : captionAt(Math.min(b - 0.1, x + 0.3))
      const last = cues[cues.length - 1]
      if (last && last.text === text && Math.abs(last.end - out) < 1e-6) last.end = out + step
      else if (text) cues.push({ text, start: out, end: out + step })
      out += step
    }
  }
  if (!VIDEO) return
  const srtPath = join(MEDIA, `groundwork-story-${tag}.srt`)
  writeFileSync(srtPath, cues.map((c, i) => `${i + 1}\n${srtTime(c.start + 0.05)} --> ${srtTime(c.end - 0.05)}\n${c.text}\n`).join('\n'))
  log('captions', srtPath, `${cues.length} cues over ${out.toFixed(1)} s`)

  if (!hasFfmpeg) {
    log('ffmpeg not found, skipped the video. Install ffmpeg and run again')
    return
  }
  if (frames.length < 10 || clock.length < 10) throw new Error('no screencast frames')
  const entries = []
  for (const [a, b] of EDIT) {
    const w0 = wallAt(a), w1 = wallAt(b)
    const seg = frames.filter((f) => f.ts >= w0 && f.ts < w1)
    if (!seg.length) throw new Error(`no frames for ${a} to ${b} s`)
    seg.forEach((f, i) => entries.push({ file: f.file, d: (seg[i + 1]?.ts ?? w1) - Math.max(f.ts, i === 0 ? w0 : f.ts) }))
  }
  const list = entries.map((e) => `file '${e.file.replaceAll(BS, '/')}'\nduration ${Math.max(0.001, e.d).toFixed(5)}`).join('\n')
  const concat = join(dir, 'frames.txt')
  writeFileSync(concat, `ffconcat version 1.0\n${list}\nfile '${entries[entries.length - 1].file.replaceAll(BS, '/')}'\n`)
  const mp4 = join(MEDIA, `groundwork-story-${tag}.mp4`)
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', concat, '-vf', `fps=${FPS},scale=trunc(iw/2)*2:trunc(ih/2)*2`, '-t', out.toFixed(3), '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4], { stdio: 'inherit' })
  if (r.status !== 0) throw new Error('ffmpeg failed')
  const span = frames[frames.length - 1].ts - frames[0].ts
  log(`video ${mp4}: ${out.toFixed(1)} s cut from a ${span.toFixed(1)} s take, ${(frames.length / span).toFixed(1)} fps captured, encoded at ${FPS} fps`)
  if (!flag('--keep-frames')) rmSync(dir, { recursive: true, force: true })
}

async function panelShots(page) {
  await page.evaluate(() => {
    window.__gw.panels(true)
    window.__gw.cam('drone')
    window.__gw.select('EX1')
  })
  await page.waitForTimeout(2500)
  const trace = page.locator('#tr-m')
  const ids = await trace.locator('option').allTextContents()
  if (ids.includes('EX1')) await trace.selectOption('EX1')
  await page.waitForTimeout(1500)
  await shot(page, '06-signal-trace.png')
  await shot(page, '10-latency-strip.png', 'section[aria-labelledby="h-latency"]')
  await shot(page, '04-site-pilot-replan.png', 'section[aria-labelledby="h-pilot"]')
  await page.evaluate(() => {
    window.__gw.panels(false)
    window.__gw.select(null)
    window.__gw.cam('cab')
  })
  await page.waitForTimeout(5000)
  await shot(page, '07-crane-cab.png')
}

async function abenixAgents(browser) {
  const web = process.env.ABENIX_WEB_URL
  if (!web) {
    log('09-abenix-agents.png skipped, set ABENIX_WEB_URL (and ABENIX_ADMIN_EMAIL, ABENIX_ADMIN_PASSWORD) to take it')
    return
  }
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  await page.goto(`${web}/agents`)
  await page.waitForTimeout(2500)
  const pw = page.locator('input[type="password"]')
  if ((await pw.count()) && process.env.ABENIX_ADMIN_EMAIL) {
    await page.locator('input[type="email"]').first().fill(process.env.ABENIX_ADMIN_EMAIL)
    await pw.first().fill(process.env.ABENIX_ADMIN_PASSWORD || '')
    await pw.first().press('Enter')
    await page.waitForFunction(() => !document.querySelector('input[type="password"]'), null, { timeout: 30000 })
    await page.goto(`${web}/agents`)
    await page.waitForTimeout(3000)
  }
  const search = page.locator('input[type="search"], input[placeholder*="Search" i]').first()
  if (await search.count()) await search.fill('gw-')
  await page.waitForTimeout(2500)
  await shot(page, '09-abenix-agents.png')
  await page.close()
}

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] })
try {
  if (flag('--proof')) {
    // phase 1 of the real imagery: the twin's machines on a real drone orthophoto, docs/real-imagery.md
    const take = opt('--take', join(root, '.run', 'take-free.json'))
    if (!existsSync(take)) {
      const r = spawnSync(process.execPath, [join(root, 'scripts', 'record-take.mjs'), '--free', '40', '--out', take], { stdio: 'inherit' })
      if (r.status !== 0) throw new Error('record-take failed')
    }
    for (const [w, h] of SIZES) await renderFilm(browser, w, h, { take, page: 'proof.html', name: 'groundwork-real-proof', spans: [[0, 30]] })
  } else if (VIDEO && !REPLAY) {
    if (REAL && !existsSync(TAKE)) throw new Error(`no ${TAKE}, record one with node scripts/record-take.mjs --site nh108 --out ${TAKE}`)
    if (flag('--retake') || !existsSync(TAKE)) {
      log('recording a live take')
      const r = spawnSync(process.execPath, [join(root, 'scripts', 'record-take.mjs'), '--out', TAKE], { stdio: 'inherit' })
      if (r.status !== 0) throw new Error('record-take failed')
    }
    if (!hasFfmpeg) throw new Error('ffmpeg not found')
    for (const [w, h] of SIZES) await renderFilm(browser, w, h, REAL ? { name: 'groundwork-real-story' } : {})
  } else for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`
    const page = await open(browser, w, h)
    const first = w === SIZES[0][0] && h === SIZES[0][1]
    if (first) await recordStory(page, tag, first)
    if (first) await panelShots(page)
    await page.close()
  }
  if (!VIDEO) await abenixAgents(browser)
} finally {
  await browser.close()
}
log('done', REPLAY ? '(replay frames, every image carries the REPLAY mark)' : '')


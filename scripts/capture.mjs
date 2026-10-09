#!/usr/bin/env node
// Records the 60 s story and the post screenshots from the running web app.
//
//   node scripts/capture.mjs                      live sim on 8710, web on 5710
//   node scripts/capture.mjs --replay             synthesised frames, everything is marked REPLAY
//   node scripts/capture.mjs --shots-only         skip the videos
//   node scripts/capture.mjs --sizes 1920x1080    one size only
//
// Frames come from the Chrome screencast with their own timestamps and are resampled to a
// constant 60 fps with ffmpeg, so the video keeps real time even when the browser drops a frame.

import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

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
  for (let i = 0; i < 100 && (await storyT(page)) === null; i++) await page.waitForTimeout(100)
  recording = true
  // captions as they were on screen, in wall time, so the SRT lines up with the video
  const t0 = Date.now() / 1000
  const shown = []
  const poll = setInterval(async () => {
    const text = await page.evaluate(() => document.querySelector('.caption')?.innerText ?? '').catch(() => '')
    const now = Date.now() / 1000 - t0
    const last = shown[shown.length - 1]
    if (last && last.text === text) last.end = now
    else if (text) shown.push({ text, start: now, end: now })
  }, 100)
  log(tag, 'story running')

  if (withShots) {
    const clean = (on) => page.evaluate((v) => window.__gw.clean(v), on)
    await waitStory(page, 2.6)
    await clean(true)
    await shot(page, '01-hero.png')
    await clean(false)
    await waitStory(page, 6.8)
    await shot(page, '03-safety-stop.png')
    await waitStory(page, 10.4)
    await shot(page, '04-site-pilot-replan.png', '.story-float.left')
    await shot(page, '05-phone-approval.png', '.phone')
    await waitStory(page, 17.5)
    await clean(true)
    await shot(page, '02-nervous-system.png')
    await clean(false)
    await waitStory(page, 24.5)
    await shot(page, '07-crane-cab.png')
    await waitStory(page, 46.5)
    await shot(page, '08-earned-autonomy.png', '.story-float.right')
  }

  for (;;) {
    const st = await page.evaluate(() => window.__gw.status())
    if (!st.story || (st.storyT ?? 0) > 61.5) break
    await page.waitForTimeout(250)
  }
  recording = false
  clearInterval(poll)
  if (hasFfmpeg && VIDEO) await cdp.send('Page.stopScreencast')
  const ts = (s) => {
    const ms = Math.max(0, Math.round(s * 1000))
    const p = (n, w = 2) => String(n).padStart(w, '0')
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`
  }
  const offset = frames.length ? frames[0].ts - t0 : 0
  const srt = shown.map((c, i) => `${i + 1}\n${ts(c.start - offset)} --> ${ts(c.end - offset + 0.1)}\n${c.text.trim()}\n`).join('\n')
  writeFileSync(join(MEDIA, `groundwork-story-${tag}.srt`), srt)
  log('captions', join(MEDIA, `groundwork-story-${tag}.srt`), `${shown.length} lines, timed to the video`)

  if (!VIDEO) return
  if (!hasFfmpeg) {
    log('ffmpeg not found, skipped the video. Install ffmpeg and run again')
    return
  }
  if (frames.length < 10) throw new Error('no screencast frames')
  const list = frames.map((f, i) => `file '${f.file.replaceAll('\\', '/')}'\nduration ${((frames[i + 1]?.ts ?? f.ts + 1 / FPS) - f.ts).toFixed(5)}`).join('\n')
  const concat = join(dir, 'frames.txt')
  writeFileSync(concat, `ffconcat version 1.0\n${list}\nfile '${frames[frames.length - 1].file.replaceAll('\\', '/')}'\n`)
  const mp4 = join(MEDIA, `groundwork-story-${tag}.mp4`)
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', concat, '-vf', `fps=${FPS},scale=trunc(iw/2)*2:trunc(ih/2)*2`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4], { stdio: 'inherit' })
  if (r.status !== 0) throw new Error('ffmpeg failed')
  const span = frames[frames.length - 1].ts - frames[0].ts
  log(`video ${mp4}: ${frames.length} source frames over ${span.toFixed(1)} s, ${(frames.length / span).toFixed(1)} fps captured, encoded at ${FPS} fps`)
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
}

async function abenixAgents(browser) {
  const web = process.env.ABENIX_WEB_URL
  if (!web) {
    log('09-abenix-agents.png skipped, set ABENIX_WEB_URL (and ABENIX_ADMIN_EMAIL, ABENIX_ADMIN_PASSWORD) to take it')
    return
  }
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  await page.goto(`${web}/agents`)
  if (/login|sign-?in/i.test(page.url()) && process.env.ABENIX_ADMIN_EMAIL) {
    await page.locator('input[type="email"]').fill(process.env.ABENIX_ADMIN_EMAIL)
    await page.locator('input[type="password"]').fill(process.env.ABENIX_ADMIN_PASSWORD || '')
    await page.locator('button[type="submit"]').click()
    await page.waitForURL((u) => !/login|sign-?in/i.test(u.toString()), { timeout: 20000 })
    await page.goto(`${web}/agents`)
  }
  const search = page.locator('input[type="search"], input[placeholder*="Search" i]').first()
  if (await search.count()) await search.fill('gw-')
  await page.waitForTimeout(2500)
  await shot(page, '09-abenix-agents.png')
  await page.close()
}

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] })
try {
  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`
    const page = await open(browser, w, h)
    const first = w === SIZES[0][0] && h === SIZES[0][1]
    if (!flag('--shots-only') || first) await recordStory(page, tag, first)
    if (first) await panelShots(page)
    await page.close()
  }
  await abenixAgents(browser)
} finally {
  await browser.close()
}
log('done', REPLAY ? '(replay frames, every image carries the REPLAY mark)' : '')
if (!existsSync(join(SHOTS, '01-hero.png'))) process.exitCode = 1

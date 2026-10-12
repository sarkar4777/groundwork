#!/usr/bin/env node
// Screenshots and a short clip of machine data streaming into Abenix: the four Groundwork PCs and the Abenix Edge demo gateway.
//
//   ABENIX_WEB_URL=http://localhost:3100 ABENIX_ADMIN_EMAIL=... ABENIX_ADMIN_PASSWORD=... node scripts/capture-abenix-telemetry.mjs
//   ... node scripts/capture-abenix-telemetry.mjs --only backfill      the history after an Edge uplink cut, once it is back
//   ... node scripts/capture-abenix-telemetry.mjs --clip                the clip for the film beat, .run/ipc/abenix-telemetry-<size>.mp4
//   --clip-name abenix-telemetry-real   a new name for the clip
//   --rule <id> --approval <id>   the closed loop views: a rule's firing history with step outputs, a command approval
//
// Signs in through the login page and opens each view by its own deep link, dark theme, live data only.
// Writes docs/screenshots/ipc/abenix-*-<width>.png and never replaces a file that is there.

import { createRequire } from 'node:module'
import { existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'web', 'package.json'))
const { chromium } = require('playwright')

const args = process.argv.slice(2)
const opt = (n, d) => {
  const i = args.indexOf(n)
  return i >= 0 && args[i + 1] ? args[i + 1] : d
}
const WEB = (process.env.ABENIX_WEB_URL || 'http://localhost:3100').replace(/\/$/, '')
const EMAIL = process.env.ABENIX_ADMIN_EMAIL
const PASSWORD = process.env.ABENIX_ADMIN_PASSWORD
const OUT = opt('--out', join(root, 'docs', 'screenshots', 'ipc'))
const WIDTHS = opt('--widths', '1440,1920').split(',').map(Number)
const ONLY = opt('--only', '')
const CLIP = args.includes('--clip')
const RULE = opt('--rule', '')
const APPROVAL = opt('--approval', '')
const log = (...a) => console.log('[abenix-telemetry]', ...a)
if (!EMAIL || !PASSWORD) {
  console.error('set ABENIX_ADMIN_EMAIL and ABENIX_ADMIN_PASSWORD')
  process.exit(1)
}
mkdirSync(OUT, { recursive: true })

const tel = (q) => `/telemetry?${new URLSearchParams(q)}`
// each view: a name, a deep link, what to wait for, and an optional element to frame
const VIEWS = [
  { name: 'telemetry-home', path: tel({ grp: 'groundwork' }), wait: '[data-testid="tel-grid"], [data-testid="tel-grid-windowed"]' },
  { name: 'devices-groundwork', path: tel({ grp: 'groundwork' }), wait: '[data-testid="tel-grid"], [data-testid="tel-grid-windowed"]', frame: '[data-testid="tel-grid"], [data-testid="tel-grid-windowed"]' },
  { name: 'ex1-engine', path: tel({ group: 'groundwork', node: 'ipc-ex1', device: 'engine', range: '15m' }), wait: '[data-testid="tel-chart"]' },
  { name: 'ex1-hydraulics', path: tel({ group: 'groundwork', node: 'ipc-ex1', device: 'hydraulics', range: '15m' }), wait: '[data-testid="tel-chart"]' },
  { name: 'ex1-swing', path: tel({ group: 'groundwork', node: 'ipc-ex1', device: 'swing', range: '15m' }), wait: '[data-testid="tel-chart"]' },
  { name: 'ex1-bus', path: tel({ group: 'groundwork', node: 'ipc-ex1', range: '15m' }), wait: '[data-testid="tel-device-detail"]' },
  { name: 'ex1-frames', path: tel({ group: 'groundwork', node: 'ipc-ex1' }), wait: '[data-testid="tel-open-frames"]', click: '[data-testid="tel-open-frames"]' },
  { name: 'ingest-health', path: tel({}), wait: '[data-testid="tel-health"]', frame: '[data-testid="tel-health"]', up: 0 },
  { name: 'devices-edge-demo', path: tel({ grp: 'edge-demo' }), wait: '[data-testid="tel-grid"], [data-testid="tel-grid-windowed"]', frame: '[data-testid="tel-grid"], [data-testid="tel-grid-windowed"]' },
  { name: 'edge-truck-7-engine', path: tel({ group: 'edge-demo', node: 'truck-7', device: 'engine', range: '15m' }), wait: '[data-testid="tel-chart"]' },
  { name: 'edge-truck-7-gps', path: tel({ group: 'edge-demo', node: 'truck-7', device: 'gps', range: '15m' }), wait: '[data-testid="tel-chart"]' },
  { name: 'edge-truck-7-bus', path: tel({ group: 'edge-demo', node: 'truck-7', device: 'bus', range: '15m' }), wait: '[data-testid="tel-chart"]' },
  { name: 'edge-truck-7-obd', path: tel({ group: 'edge-demo', node: 'truck-7-obd', device: 'engine', range: '15m' }), wait: '[data-testid="tel-chart"]' },
  { name: 'edge-meter-1', path: tel({ group: 'edge-demo', node: 'meter-1', device: 'main', range: '15m' }), wait: '[data-testid="tel-chart"]' },
  { name: 'edge-truck-7-all-parts', path: tel({ group: 'edge-demo', node: 'truck-7', focus: 'charts', range: '15m' }), wait: '[data-testid="tel-chart"]' },
  { name: 'edge-opc-plc', path: tel({ group: 'edge-demo', node: 'opc-plc', device: 'plc', range: '15m' }), wait: '[data-testid="tel-chart"]' },
  { name: 'testbed-opc-plc-boiler', path: tel({ group: 'plant', node: 'opc-plc', range: '15m', metric: 'Boiler2/Temperature_C' }), wait: '[data-testid="tel-chart"]' },
  { name: 'edge-gateway', path: '/edge', wait: '[data-testid="edge-gateways"]' },
  ...(RULE ? [{ name: 'loop-rule-firings', path: `/telemetry/rules/${RULE}`, wait: '[data-testid="firing-history"]', click: '[data-testid="firing-step-toggle"]' }] : []),
  ...(APPROVAL ? [{ name: 'loop-command-approved', path: `/approvals#${APPROVAL}`, wait: `[data-approval-id="${APPROVAL}"]`, frame: `[data-approval-id="${APPROVAL}"]`, up: 0 }] : []),
  { name: 'loop-asset-agents', path: '/telemetry/agents', wait: 'main' },
  { name: 'backfill', path: tel({ group: 'edge-demo', node: 'truck-7', device: 'engine', range: '15m' }), wait: '[data-testid="tel-chart"]', frame: '[data-testid="tel-device-detail"]', manual: true },
]

const browser = await chromium.launch()

async function context(width) {
  const ctx = await browser.newContext({ viewport: { width, height: Math.round((width * 9) / 16) }, deviceScaleFactor: 2, colorScheme: 'dark' })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => log('page error:', e.message))
  await page.goto(`${WEB}/dashboard`)
  await page.waitForTimeout(2500)
  const pw = page.locator('input[type="password"]')
  if (await pw.count()) {
    await page.locator('input[type="email"]').first().fill(EMAIL)
    await pw.first().fill(PASSWORD)
    await pw.first().press('Enter')
    await page.waitForFunction(() => !document.querySelector('input[type="password"]'), null, { timeout: 30000 })
  }
  return { ctx, page }
}

// a chart is ready once it has drawn real points, a live view once the stream says live
async function settle(page, v) {
  await page.waitForSelector(v.wait, { timeout: 30000 })
  await page.waitForFunction(() => {
    const c = [...document.querySelectorAll('[data-testid="tel-chart"]')]
    return !c.length || c.some((x) => Number(x.getAttribute('data-points') || 0) > 5)
  }, null, { timeout: 30000 }).catch(() => log(v.name, 'chart has few points, taken as it is'))
  await page.waitForTimeout(4000)
  if (v.click) {
    await page.locator(v.click).first().click()
    await page.waitForTimeout(4000)
  }
  if (v.scroll) {
    await page.locator(v.scroll).first().evaluate((el) => el.scrollIntoView({ block: 'start' }))
    if (v.scrollBy) await page.mouse.wheel(0, v.scrollBy)
    await page.waitForTimeout(1500)
  }
}

async function shoot(page, v, width) {
  const path = join(OUT, `abenix-${v.name}-${width}.png`)
  if (existsSync(path)) {
    log('kept', path, '(already there, not replaced)')
    return
  }
  await page.goto(`${WEB}${v.path}`)
  await settle(page, v)
  if (v.frame && !v.up) await page.locator(v.frame).first().screenshot({ path })
  else if (v.frame) {
    // the strip around the element, a few levels up
    const box = await page.evaluate(({ sel, up }) => {
      let el = document.querySelector(sel)
      for (let i = 0; el && i < up; i++) el = el.parentElement
      const r = el?.getBoundingClientRect()
      return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null
    }, { sel: v.frame, up: v.up ?? 0 })
    await page.screenshot({ path, ...(box ? { clip: box } : {}) })
  } else await page.screenshot({ path })
  log('saved', path)
}

async function clip() {
  const [w, h] = [1920, 1080]
  const out = join(root, '.run', 'ipc', `${opt('--clip-name', 'abenix-telemetry')}-${w}x${h}.mp4`)
  if (existsSync(out)) throw new Error(`${out} is already there, move it away first`)
  mkdirSync(dirname(out), { recursive: true })
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, colorScheme: 'dark' })
  const page = await ctx.newPage()
  await page.goto(`${WEB}/dashboard`)
  await page.waitForTimeout(2500)
  const pw = page.locator('input[type="password"]')
  if (await pw.count()) {
    await page.locator('input[type="email"]').first().fill(EMAIL)
    await pw.first().fill(PASSWORD)
    await pw.first().press('Enter')
    await page.waitForFunction(() => !document.querySelector('input[type="password"]'), null, { timeout: 30000 })
  }
  // three beats: every PC live, EX1's engine streaming, the raw frames
  const view = (n) => VIEWS.find((v) => v.name === n)
  const beats = [
    { v: view('ex1-bus'), s: 4.5 },
    { v: view('ex1-engine'), s: 4.5 },
    { v: view('ex1-frames'), s: 3.5 },
  ]
  const FPS = 20
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', out], { stdio: ['pipe', 'inherit', 'inherit'] })
  const done = new Promise((r) => ff.on('close', r))
  for (const b of beats) {
    await page.goto(`${WEB}${b.v.path}`)
    await settle(page, b.v)
    // frames on a fixed cadence, so the clip runs at the speed the data arrived: a slow screenshot
    // holds the last frame for the slots it missed rather than speeding the clip up
    const t0 = Date.now()
    const slots = Math.round(b.s * FPS)
    let k = 0
    while (k < slots) {
      const wait = t0 + (k * 1000) / FPS - Date.now()
      if (wait > 0) await page.waitForTimeout(wait)
      const buf = await page.screenshot({ type: 'jpeg', quality: 92 })
      const upto = Math.min(slots, Math.max(k + 1, Math.floor(((Date.now() - t0) * FPS) / 1000)))
      for (; k < upto; k++) if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r))
    }
  }
  ff.stdin.end()
  if ((await done) !== 0) throw new Error('ffmpeg failed')
  log('clip', out)
  await ctx.close()
}

try {
  if (CLIP) await clip()
  else {
    const views = VIEWS.filter((v) => (ONLY ? ONLY.split(',').includes(v.name) : !v.manual))
    for (const width of WIDTHS) {
      const { ctx, page } = await context(width)
      for (const v of views) {
        try {
          await shoot(page, v, width)
        } catch (e) {
          log(v.name, width, 'not taken:', e.message)
        }
      }
      await ctx.close()
    }
  }
} finally {
  await browser.close()
}

#!/usr/bin/env node
// Stills of the story on real ground, taken from the same recorded take the real film plays.
// The page steps its own clock, so every still is a frame the film could show.
//
//   node scripts/capture-real-shots.mjs [--url http://localhost:5710] [--take .run/take-real.json] [--out docs/screenshots/real]
//   node scripts/capture-real-shots.mjs --take .run/take.json --shots 2:a.png,17.5:b.png --out /tmp/x   any take, any story seconds

import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'web', 'package.json'))
const { chromium } = require('playwright')
const args = process.argv.slice(2)
const opt = (n, d) => {
  const i = args.indexOf(n)
  return i >= 0 && args[i + 1] ? args[i + 1] : d
}
const WEB = opt('--url', process.env.GW_WEB_URL || 'http://localhost:5710')
const TAKE = opt('--take', join(root, '.run', 'take-real.json'))
const OUT = opt('--out', join(root, 'docs', 'screenshots', 'real'))
mkdirSync(OUT, { recursive: true })

// story seconds, file, and what to keep in frame
const LIST = opt('--shots', '')
const SHOTS = LIST ? LIST.split(',').map((x) => ({ s: Number(x.split(':')[0]), name: x.split(':')[1] })) : [
  { s: 2.6, name: '01-hero.png', clean: true },
  { s: 17.5, name: '02-nervous-system.png', clean: true },
  { s: 6.6, name: '03-safety-stop.png' },
  { s: 11.2, name: '05-phone-approval.png', sel: '.sc-phone .phone' },
  { s: 24.5, name: '09-gust-hold.png' },
  { s: 30.0, name: '10-ai-offline.png' },
  { s: 34.0, name: '04-ground-station.png' },
  { s: 41.5, name: '06-signal-trace.png' },
  { s: 49.5, name: '07-new-telehandler.png' },
  { s: 53.5, name: '08-earned-autonomy.png', sel: '.sc-auto' },
  { s: 60.0, name: '11-end-card.png' },
]

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] })
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
const page = await context.newPage()
page.on('pageerror', (e) => console.log('page error:', e.message))
await page.route('**/__take.json', (r) => r.fulfill({ path: TAKE, contentType: 'application/json' }))
await page.clock.install({ time: Date.now() })
await page.goto(`${WEB}/?capture=1&playback=1&render=1`)
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
  })
for (let i = 0; i < 160; i++) {
  await page.clock.runFor(17)
  await flush()
  await page.waitForTimeout(i < 30 ? 120 : 30)
}
const tl = await page.evaluate(() => window.__gw.timeline())
const base = await page.evaluate(() => {
  window.__gw.go()
  return performance.now()
})
let ms = 0
let k = 0
for (const shot of [...SHOTS].sort((a, b) => a.s - b.s)) {
  const v = tl.storyV + shot.s
  while (ms / 1000 < v) {
    k += 1
    const t = k / 60
    await page.evaluate((x) => window.__gwNow(x), base + t * 1000)
    const target = Math.round(t * 1000)
    await page.clock.runFor(target - ms)
    ms = target
    await flush()
  }
  if (shot.clean) await page.evaluate(() => window.__gw.clean(true))
  await flush()
  await page.waitForTimeout(400)
  const path = join(OUT, shot.name)
  if (shot.sel) await page.locator(shot.sel).first().screenshot({ path })
  else await page.screenshot({ path })
  if (shot.clean) await page.evaluate(() => window.__gw.clean(false))
  console.log('saved', path)
}
await browser.close()

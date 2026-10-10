#!/usr/bin/env node
// Close stills of every photographic machine on the real ground, three angles each, plus a top-down scale
// check beside a real excavator in the untouched photo. Needs the web on 5710 and data/real/nh108.
//
//   node scripts/capture-machines.mjs [--out data/real/tests/machines]

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
const OUT = opt('--out', join(root, 'data', 'real', 'tests', 'machines'))
const ONLY = opt('--only', '')
mkdirSync(OUT, { recursive: true })

const MACHINES = ['excavator', 'truck', 'dozer', 'roller', 'loader', 'telehandler', 'piling', 'mobile_crane', 'tower_crane']
const VIEWS = ['top', 'oblique', 'side']
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
page.on('pageerror', (e) => console.log('page error:', e.message))
const shots = [...MACHINES.flatMap((m) => VIEWS.map((v) => [m, v])), ['excavator', 'scale']].filter(([m]) => !ONLY || ONLY.split(',').includes(m))
for (const [m, v] of shots) {
  await page.goto(`${WEB}/proof.html?gallery=1&machine=${m}&view=${v}`)
  await page.waitForSelector('canvas', { timeout: 60000 })
  await page.waitForTimeout(4500)
  const path = join(OUT, `${m}-${v}.png`)
  await page.screenshot({ path })
  console.log('saved', path)
}
await browser.close()

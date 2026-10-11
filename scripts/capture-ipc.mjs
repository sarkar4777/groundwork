#!/usr/bin/env node
// Screenshots of the industrial PCs in the ground station, live, through the same buttons a person uses.
//
//   node scripts/capture-ipc.mjs [--url http://localhost:5710]
//
// Needs the bff with the PCs in Abenix. Writes to docs/screenshots/ipc/ and never replaces a file that is there.

import { createRequire } from 'node:module'
import { existsSync, mkdirSync } from 'node:fs'
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
const WEB = opt('--url', process.env.GW_WEB_URL || 'http://localhost:5710').replace(/\/$/, '')
const OUT = opt('--out', join(root, 'docs', 'screenshots', 'ipc'))
mkdirSync(OUT, { recursive: true })
const log = (...a) => console.log('[ipc]', ...a)

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
page.on('pageerror', (e) => log('page error:', e.message))

async function shot(name, selector) {
  const path = join(OUT, name)
  if (existsSync(path)) {
    log('kept', path, '(already there, not replaced)')
    return
  }
  if (selector) await page.locator(selector).first().screenshot({ path })
  else await page.screenshot({ path })
  log('saved', path)
}

try {
  await page.goto(`${WEB}/?capture=1`)
  await page.waitForFunction(() => window.__gw?.status().hasState && window.__gw.status().terrain, null, { timeout: 90000 })
  await page.waitForFunction(() => !!document.querySelector('.mlabel .src.ipc'), null, { timeout: 30000 }).catch(() => {
    throw new Error('no machine tagged IPC, is the bff reading the PCs from Abenix?')
  })
  await page.waitForTimeout(4000)
  await page.evaluate(() => {
    window.__gw.panels(true)
    window.__gw.cam('orbit')
  })
  await page.waitForTimeout(3000)
  await shot('01-ipc-and-sim-labels.png')

  await page.evaluate(() => {
    window.__gw.cam('drone')
    window.__gw.select('EX1')
  })
  await page.waitForTimeout(3000)
  await shot('02-ex1-on-its-pc.png')
  await shot('03-ex1-card.png', 'aside.mcard')

  await page.locator('#tr-p').selectOption('ipc')
  await page.locator('#tr-m').selectOption('EX1').catch(() => {})
  await page.waitForTimeout(2500)
  await shot('04-signal-trace-real-bus.png', 'section[aria-labelledby="h-trace"]')
  await page.locator('#tr-p').selectOption('all')
  await page.locator('#tr-m').selectOption('all').catch(() => {})
  await shot('05-fault-deck.png', 'section[aria-labelledby="h-faults"]')

  await page.evaluate(() => {
    window.__gw.select(null)
    window.__gw.cam('nervous')
  })
  await page.waitForTimeout(4000)
  await shot('06-nervous-system-hops.png')

  // the PC off the broker: the fault deck's own button
  await page.evaluate(() => {
    window.__gw.cam('drone')
    window.__gw.select('EX1')
  })
  await page.getByRole('button', { name: /Unplug EX1's PC/ }).first().click()
  await page.waitForFunction(() => !!document.querySelector('.mlabel .src.ipc.off'), null, { timeout: 15000 })
  await page.waitForTimeout(2500)
  await shot('07-ex1-pc-offline.png')
  await page.waitForFunction(() => !document.querySelector('.mlabel .src.ipc.off'), null, { timeout: 40000 })
  await page.waitForTimeout(6000)

  await page.getByRole('button', { name: /Noisy harness on EX1/ }).first().click()
  await page.evaluate(() => {
    window.__gw.select(null)
    window.__gw.cam('nervous')
  })
  await page.waitForFunction(() => !!document.querySelector('.hops-noise'), null, { timeout: 15000 })
  await page.waitForTimeout(2500)
  await shot('08-noisy-harness.png')
} finally {
  await browser.close()
}
log('done')

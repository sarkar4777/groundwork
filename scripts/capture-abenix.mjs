#!/usr/bin/env node
// Screenshots of Groundwork's work inside Abenix, taken the way a person would see it.
//
//   ABENIX_WEB_URL=http://localhost:3100 ABENIX_ADMIN_EMAIL=... ABENIX_ADMIN_PASSWORD=... node scripts/capture-abenix.mjs
//
// Signs in through the login page, uses each page's own search and controls, and writes PNGs
// to docs/screenshots/abenix/. Every list is narrowed to the gw- resources.

import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'web', 'package.json'))
const { chromium } = require('playwright')

const WEB = (process.env.ABENIX_WEB_URL || 'http://localhost:3100').replace(/\/$/, '')
const EMAIL = process.env.ABENIX_ADMIN_EMAIL
const PASSWORD = process.env.ABENIX_ADMIN_PASSWORD
const OUT = join(root, 'docs', 'screenshots', 'abenix')
const only = process.argv.slice(2)
mkdirSync(OUT, { recursive: true })
const log = (...a) => console.log('[abenix]', ...a)

if (!EMAIL || !PASSWORD) {
  console.error('set ABENIX_ADMIN_EMAIL and ABENIX_ADMIN_PASSWORD')
  process.exit(1)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, colorScheme: 'dark' })
const page = await ctx.newPage()

async function signIn() {
  await page.goto(`${WEB}/dashboard`)
  await page.waitForTimeout(2500)
  const pw = page.locator('input[type="password"]')
  if (!(await pw.count())) return
  await page.locator('input[type="email"]').first().fill(EMAIL)
  await pw.first().fill(PASSWORD)
  await pw.first().press('Enter')
  await page.waitForFunction(() => !document.querySelector('input[type="password"]'), null, { timeout: 30000 })
}

async function open(path, wait = 4500) {
  await page.goto(WEB + path)
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(wait)
  await tidy()
}

// Fold the explainer panels and close one-off tips, as a returning user would.
async function tidy() {
  for (const b of await page.getByRole('button', { name: /^How this works$/ }).all()) {
    const expanded = await b.getAttribute('aria-expanded')
    if (expanded !== 'false') await b.click().catch(() => {})
  }
  for (const label of ['Close', 'Dismiss', 'Got it']) {
    const b = page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') })
    if (await b.count()) await b.first().click().catch(() => {})
  }
  await page.waitForTimeout(400)
}

async function scrollTo(text, offset = 90) {
  const el = page.getByText(text, { exact: false }).first()
  if (!(await el.count())) return false
  await el.evaluate((n, off) => {
    let s = n.parentElement
    while (s && !(s.scrollHeight > s.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(s).overflowY))) s = s.parentElement
    const target = s || document.scrollingElement
    const top = n.getBoundingClientRect().top - (s ? s.getBoundingClientRect().top : 0) + target.scrollTop - off
    target.scrollTo({ top })
  }, offset)
  await page.waitForTimeout(700)
  return true
}

async function shot(name, caption) {
  await page.mouse.move(5, 1075)
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(OUT, name) })
  log(name, '-', caption)
}

async function search(text) {
  const s = page.locator('input[placeholder*="Search" i]').first()
  if (await s.count()) {
    await s.fill(text)
    await page.waitForTimeout(2500)
  }
}

async function agentId(name) {
  await open('/agents')
  await search('gw-')
  return page.evaluate((n) => {
    const a = [...document.querySelectorAll('a[href*="/agents/"]')].find((x) => x.innerText.trim().startsWith(n))
    return a?.getAttribute('href')?.split('/')[2] ?? null
  }, name)
}

const shots = {
  async agents() {
    await open('/agents')
    await search('gw-')
    await shot('01-agents.png', 'The 16 Groundwork agents and pipelines in Abenix, grouped under Construction')
  },

  async flight() {
    await open('/executions')
    await page.locator('select').nth(0).selectOption('completed').catch(() => {})
    await search('train')
    const href = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('a[href^="/executions/"]')].filter((a) => /Train/.test(a.innerText) && !/live/.test(a.getAttribute('href')))
      const secs = (a) => parseFloat((a.innerText.match(/(\d+(?:\.\d+)?)s/) || [])[1] || '0')
      rows.sort((a, b) => secs(b) - secs(a))
      return rows[0]?.getAttribute('href') ?? null
    })
    if (!href) throw new Error('no completed GW Train models run to open')
    await open(href)
    const close = page.locator('button[aria-label*="lose" i], button[title*="lose" i]').first()
    if (await close.count()) await close.click().catch(() => {})
    await scrollTo('LIVE DAG', 110)
    const step = page.getByRole('button', { name: /Twin generates data/ }).first()
    if (await step.count()) await step.click().catch(() => {})
    await page.waitForTimeout(1200)
    await shot('02-flight-recorder.png', 'Flight Recorder: gw-train-models generating twin data then training and exporting ONNX, step by step')
    if (await scrollTo('EXECUTION WATERFALL', 90)) await shot('03-flight-recorder-waterfall.png', 'Flight Recorder waterfall and the payloads of each code-asset step')
  },

  async dag() {
    // the richest Groundwork pipeline by node count
    await open('/agents')
    await search('gw-')
    const ids = await page.evaluate(() => [...document.querySelectorAll('a[href*="/agents/"]')].filter((a) => /^GW (Near miss|Shift start|Train models|Weather hold|Dispatch loop)/.test(a.innerText.trim())).map((a) => [a.innerText.trim().split(/\r?\n/)[0], a.getAttribute('href').split('/')[2]]))
    let best = null
    for (const [name, id] of ids) {
      await open(`/builder?agent=${id}`, 5000)
      const n = await page.locator('.react-flow__node').count()
      log('pipeline', name, n, 'nodes')
      if (!best || n > best.n) best = { name, id, n }
    }
    if (!best) throw new Error('no gw pipelines found')
    await open(`/agents/${best.id}/info`)
    await page.getByRole('link', { name: /^Edit$/ }).first().click()
    await page.waitForTimeout(6000)
    const fit = page.locator('.react-flow__controls-fitview, button[title*="fit" i], button[aria-label*="fit" i]').first()
    if (await fit.count()) await fit.click().catch(() => {})
    await page.waitForTimeout(1500)
    await shot('04-pipeline-dag.png', `The ${best.name} pipeline in the Abenix builder, ${best.n} steps`)
  },

  async ml() {
    await open('/ml-models')
    await page.getByText('gw-worker-path').first().click()
    await page.waitForTimeout(2500)
    await page.getByRole('button', { name: /Run Prediction/ }).click()
    await page.waitForTimeout(3500)
    await scrollTo('gw-worker-path', 70)
    await shot('05-ml-model.png', 'gw-worker-path, an ONNX model Abenix trained on twin data, predicting a worker 1 to 3 s ahead')
  },

  async code() {
    await open('/code-runner')
    await page.getByText('gw-site-twin').first().click()
    await page.waitForTimeout(3000)
    await scrollTo('gw-site-twin', 70)
    await shot('06-code-asset.png', 'gw-site-twin, the site twin running as a Python code asset in Abenix, with its versions and run commands')
  },

  async analytics() {
    await open('/analytics')
    await scrollTo('Executions Over Time', 260)
    await shot('07-analytics.png', 'Abenix analytics over the runs Groundwork drives: executions, tokens and cost')
  },

  async decision() {
    await open('/decisions/gw.safety.exclusion')
    // the published version, not a draft someone is editing
    const v = page.getByRole('button', { name: /Version \d+/ }).first()
    if (await v.count()) {
      await v.click().catch(() => {})
      await page.waitForTimeout(800)
      const pub = page.getByText(/in force|published/i).first()
      if (await pub.count()) await pub.click().catch(() => {})
      await page.waitForTimeout(2500)
      await tidy()
    }
    // try a worker 2.5 m from a bucket moving at 3 m/s
    for (const [fact, value] of [['machine.tip_speed_ms', '3'], ['worker.clearance_m', '2.5']]) {
      const input = page.locator(`xpath=(//*[normalize-space(text())="${fact}"])[last()]/following::input[1]`)
      if (await input.count()) await input.fill(value).catch(() => {})
    }
    await page.waitForTimeout(2500)
    await shot('08-decision-rules.png', 'gw.safety.exclusion in force: the swing-zone rules, with Try it deciding stop for a worker 2.5 m from a fast bucket')
    for (const [tab, file, cap] of [['Flow', '09-decision-flow.png', 'The exclusion rules as a decision flow'], ['Table', '09-decision-table.png', 'The exclusion rules as a decision table']]) {
      const t = page.getByRole('button', { name: tab, exact: true }).or(page.getByRole('tab', { name: tab, exact: true })).first()
      if (!(await t.count())) continue
      await t.click().catch(() => {})
      await page.waitForTimeout(2000)
      await shot(file, cap)
    }
  },

  async autonomy() {
    await open('/autonomy')
    await scrollTo('AGENTS AND ACTIONS', 200)
    await shot('10-autonomy.png', 'Earned Autonomy: the Groundwork agents enrolled per action type, watching and earning their record')
  },

  async agent() {
    const id = await agentId('GW Site Superintendent')
    if (!id) throw new Error('GW Site Superintendent not found')
    await open(`/agents/${id}/info`)
    await shot('11-agent.png', 'GW Site Superintendent: its model, tools and knowledge in Abenix')
  },
}

try {
  await signIn()
  for (const [name, fn] of Object.entries(shots)) {
    if (only.length && !only.includes(name)) continue
    try {
      await fn()
    } catch (e) {
      log(name, 'failed:', e.message.split('\n')[0])
    }
  }
} finally {
  await browser.close()
}

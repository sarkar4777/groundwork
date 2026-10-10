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

// The card around each anchor (text, or a CSS selector when css is set), cropped together at 2x.
// The card around each anchor (text, or a CSS selector matching every element when css is set),
// scrolled to the top of the view and cropped together at 2x, above the status bar.
async function crop(anchors, name, caption, css = false, pad = 14) {
  const card = (n) => {
    let e = n
    while (e && e.parentElement) {
      const cs = getComputedStyle(e)
      if (parseFloat(cs.borderTopLeftRadius) >= 6 && cs.borderTopWidth !== '0px' && e.getBoundingClientRect().width > 320) return e
      e = e.parentElement
    }
    return n
  }
  const locs = []
  for (const a of anchors) {
    const loc = css ? page.locator(a) : page.getByText(new RegExp('^\\s*' + a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')).first()
    if (await loc.count()) locs.push(loc)
  }
  if (!locs.length) return log(name, 'skipped, nothing to crop')
  // bring the first card to just under the header
  await locs[0].first().evaluate((n, c) => {
    const e = new Function('return ' + c)()(n)
    let s = e.parentElement
    while (s && !(s.scrollHeight > s.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(s).overflowY))) s = s.parentElement
    if (s) s.scrollTop += e.getBoundingClientRect().top - s.getBoundingClientRect().top - 24
  }, css ? 'n => n' : card.toString())
  await page.waitForTimeout(700)
  const rects = []
  for (const loc of locs) {
    const all = css ? await loc.all() : [loc]
    for (const l of all) {
      rects.push(await l.evaluate((n, c) => {
        const e = new Function('return ' + c)()(n)
        const b = e.getBoundingClientRect()
        return { x: b.left, y: b.top, w: b.width, h: b.height }
      }, css ? 'n => n' : card.toString()))
    }
  }
  const x0 = Math.min(...rects.map((r) => r.x)), y0 = Math.min(...rects.map((r) => r.y))
  const x1 = Math.max(...rects.map((r) => r.x + r.w)), y1 = Math.max(...rects.map((r) => r.y + r.h))
  const left = Math.max(0, x0 - pad), top = Math.max(0, y0 - pad)
  const clip = { x: left, y: top, width: Math.min(1920, x1 + pad) - left, height: Math.min(1050, y1 + pad) - top }
  mkdirSync(join(OUT, 'crops'), { recursive: true })
  await page.mouse.move(5, 1075)
  await page.screenshot({ path: join(OUT, name), clip })
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
    await search('Near miss')
    const href = await page.evaluate(() => [...document.querySelectorAll('a[href^="/executions/"]')].find((a) => /GW Near miss/.test(a.innerText) && /tok/.test(a.innerText))?.getAttribute('href') ?? null)
    if (!href) throw new Error('no completed GW Near miss run to open')
    await open(href)
    const close = page.locator('button[aria-label*="lose" i], button[title*="lose" i]').first()
    if (await close.count()) await close.click().catch(() => {})
    await scrollTo('LIVE DAG', 110)
    await scrollTo('TOOL CALL INSPECTOR', 60)
    await shot('02-flight-recorder.png', 'Flight Recorder of a gw-near-miss run: the rule re-checked in Abenix Decisions decides stop, with the rule that applied and its source')
    if (await scrollTo('EXECUTION WATERFALL', 90)) await shot('03-flight-recorder-waterfall.png', 'The same run: waterfall, tool calls with their payloads, pipeline table and data lineage')
    await crop(['EXECUTION WATERFALL'], 'crops/c5-flight-waterfall.png', 'Flight Recorder waterfall of a gw-near-miss run')
    await crop(['DATA LINEAGE GRAPH'], 'crops/c6-flight-lineage.png', 'Data lineage of a gw-near-miss run, from the safety stop to the Safety Officer write-up')
  },

  async dag() {
    // Fault triage is the three-step graph, Weather hold the fallback if the builder still flags it
    for (const name of ['GW Fault triage', 'GW Weather hold']) {
      const id = await agentId(name)
      if (!id) continue
      await open(`/agents/${id}/info`)
      await page.getByRole('link', { name: /^Edit$/ }).first().click()
      await page.waitForTimeout(6000)
      const fit = page.locator('.react-flow__controls-fitview, button[title*="fit" i], button[aria-label*="fit" i]').first()
      if (await fit.count()) await fit.click().catch(() => {})
      await page.waitForTimeout(1500)
      if (await page.getByRole('button', { name: /\d+ errors?/ }).count()) {
        log('dag:', name, 'still shows an error badge in the builder')
        continue
      }
      await shot('04-pipeline-dag.png', `The ${name.replace('GW ', 'gw-').toLowerCase().replace(/ /g, '-')} pipeline in the Abenix builder`)
      await crop(['.react-flow__node'], 'crops/c7-pipeline-dag.png', `${name} as an Abenix pipeline`, true, 36)
      return
    }
  },

  async ml() {
    await open('/ml-models')
    await page.getByText('gw-gust-nowcast', { exact: true }).first().click()
    await page.waitForTimeout(2500)
    await page.getByRole('button', { name: /Run Prediction/ }).click()
    await page.waitForTimeout(2500)
    await page.getByRole('button', { name: /Explain/ }).first().click()
    await page.waitForTimeout(8000)
    await scrollTo('TEST INFERENCE', 40)
    await shot('05-ml-model.png', 'gw-gust-nowcast in Abenix ML: a live prediction of the next 60 s gust and the exact Shapley explanation of it')
    await crop(['From a baseline'], 'crops/c3-ml-explain.png', 'Why the gust nowcast said 13 m/s: each wind feature pushing the prediction up or down')
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
    await crop(['Executions Over Time'], 'crops/c1-analytics-executions.png', 'Executions over time in Abenix')
    await crop(['Cost by Agent'], 'crops/c2-analytics-cost-by-agent.png', 'Cost by agent, Groundwork runs on a Claude subscription')
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
      if (tab === 'Flow') {
        const fitv = page.locator('.react-flow__controls-fitview').first()
        if (await fitv.count()) await fitv.click().catch(() => {})
        await page.waitForTimeout(800)
      }
      if (tab === 'Flow') await crop(['Graph', 'Try it'], 'crops/c4-decision-flow-tryit.png', 'gw.safety.exclusion as a decision flow, deciding stop in microseconds')
    }
  },

  async autonomy() {
    await open('/autonomy')
    await scrollTo('AGENTS AND ACTIONS', 200)
    await shot('10-autonomy.png', 'Earned Autonomy: the Groundwork agents enrolled per action type, watching and earning their record')
    await crop(['section:has(table)'], 'crops/c8-autonomy-matrix.png', 'Earned Autonomy matrix: each Groundwork agent and the actions it is enrolled for', true)
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

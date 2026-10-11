#!/usr/bin/env node
// Records one live take of the story from the bff: every frame on the channel, the site, each
// terrain revision and the agents, so capture.mjs can render it frame by frame, offline.
//
//   node scripts/record-take.mjs [--out .run/take.json] [--pre 8] [--post 8]
//   node scripts/record-take.mjs --free 45 --out .run/take-free.json
//   node scripts/record-take.mjs --ipc --out .run/take-ipc.json      the industrial PC story, live
//   node scripts/record-take.mjs --loop --out .run/take-loop.json    the closed loop on EX1, live, waits for Abenix
//
// The pre-roll is the running site before the story starts, used for the opening title.

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const opt = (n, d) => {
  const i = args.indexOf(n)
  return i >= 0 && args[i + 1] ? args[i + 1] : d
}
const BFF = opt('--bff', process.env.GW_BFF_URL || 'http://localhost:8710').replace(/\/$/, '')
const OUT = opt('--out', join(root, '.run', 'take.json'))
const PRE = Number(opt('--pre', '8'))
const POST = Number(opt('--post', '8'))
// --free 45 records the running site for 45 s and starts no story
const FREE = Number(opt('--free', '0'))
// --site nh108 runs the story on the real-site layout, the bff's own default otherwise
const SITE = opt('--site', '')
const IPC = args.includes('--ipc')
const LOOP = args.includes('--loop')
// a loop story waits on a rule, an agent and a person, so it may run for many minutes
const MAX_S = Number(opt('--max', LOOP ? '1200' : '150'))
const log = (...a) => console.log('[take]', ...a)

const get = async (path, tries = 5) => {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(BFF + path)
      if (!r.ok) throw new Error(`${path} returned ${r.status}`)
      return await r.json()
    } catch (e) {
      if (i >= tries) throw e
      await new Promise((r) => setTimeout(r, 400 * i))
    }
  }
}

const take = { recorded_at: new Date().toISOString(), bff: BFF, frames: [], terrain: {}, site: null, agents: [], health: null, storyAt: -1 }
const wall0 = Date.now()
const now = () => (Date.now() - wall0) / 1000
const seenRev = new Set()
let finishedAt = -1

async function terrain(rev) {
  const key = `${take.storyAt < 0 ? 'a' : 'b'}:${rev}`
  if (seenRev.has(key)) return
  seenRev.add(key)
  try {
    take.terrain[key] = await get(`/terrain?rev=${rev}`)
  } catch (e) {
    log('terrain', rev, 'failed', e.message)
  }
}

async function agents() {
  try {
    take.agents.push({ at: take.frames.length, data: await get('/agents') })
  } catch (e) {
    log('agents failed', e.message)
  }
}

take.health = await get('/health').catch(() => null)
take.site = await get('/site')
await agents()

const ws = new WebSocket(BFF.replace(/^http/, 'ws') + '/ws')
ws.onmessage = (e) => {
  let f
  try {
    f = JSON.parse(e.data)
  } catch {
    return
  }
  const list = Array.isArray(f) ? f : [f]
  for (const x of list) {
    take.frames.push({ w: now(), f: x })
    if (x.type === 'state' && x.terrain) terrain(x.terrain.rev)
    if (x.type === 'event' && x.kind === 'story' && /^story started/i.test(x.title) && take.storyAt < 0) {
      take.storyAt = take.frames.length - 1
      log('story started at frame', take.storyAt)
      take.site_story = null
      get('/site').then((s) => (take.site_story = s)).catch(() => {})
    }
    if (x.type === 'event' && x.kind === 'autonomy') agents()
    if (x.type === 'event' && x.kind === 'story' && /^story finished/i.test(x.title) && finishedAt < 0) {
      finishedAt = now()
      log('story finished')
    }
  }
}
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = () => rej(new Error(`no websocket at ${BFF}/ws`))
})
if (FREE > 0) {
  log('recording the running site for', FREE, 's')
  await new Promise((r) => setTimeout(r, FREE * 1000))
  ws.close()
  await agents()
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(take))
  log(`saved ${OUT}: ${take.frames.length} frames, ${take.frames.filter((x) => x.f.type === 'state').length} states`)
  process.exit(0)
}
log('recording pre-roll', PRE, 's')
await new Promise((r) => setTimeout(r, PRE * 1000))
const r = await fetch(BFF + '/story/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...(SITE ? { site: SITE } : {}), ...(IPC ? { ipc: true } : {}), ...(LOOP ? { loop: true } : {}) }) })
log('story/start', r.status, await r.text())
const deadline = Date.now() + MAX_S * 1000
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 250))
  if (finishedAt >= 0 && now() - finishedAt >= POST) break
}
ws.close()
await agents()
await new Promise((r) => setTimeout(r, 1500))
if (take.storyAt < 0) throw new Error('the story never started')
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(take))
const states = take.frames.filter((x) => x.f.type === 'state')
log(`saved ${OUT}: ${take.frames.length} frames, ${states.length} states, ${Object.keys(take.terrain).length} terrain revisions, finished ${finishedAt >= 0 ? 'yes' : 'no'}`)

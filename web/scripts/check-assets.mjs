import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const assetsDir = join(root, 'public', 'assets')
const manifest = readFileSync(join(root, '..', 'ASSETS.md'), 'utf8')

const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f)
  return statSync(p).isDirectory() ? walk(p) : [p]
})

const missing = walk(assetsDir)
  .map((p) => relative(join(root, 'public'), p).replaceAll('\', '/'))
  .filter((p) => !manifest.includes(p))

if (missing.length) {
  console.error('Assets missing from ASSETS.md:\n  ' + missing.join('\n  '))
  process.exit(1)
}
console.log('assets ok')

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const assetsDir = join(root, 'public', 'assets')
const manifest = readFileSync(join(root, '..', 'ASSETS.md'), 'utf8')

const walk = (d) =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })

const missing = walk(assetsDir)
  .map((p) => relative(join(root, 'public'), p).split(sep).join('/'))
  .filter((p) => !manifest.includes(p))

if (missing.length) {
  console.error('Assets missing from ASSETS.md:\n  ' + missing.join('\n  '))
  process.exit(1)
}
console.log('assets ok')

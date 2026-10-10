import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'

const sim = process.env.SIM_URL || 'http://localhost:8710'
const proxy = {
  '/sim': { target: sim, changeOrigin: true, ws: true, rewrite: (p: string) => p.replace(/^\/sim/, '') },
}

// Real imagery stays out of git, scripts/fetch-real-imagery.py puts it in data/real.
const realDir = resolve(__dirname, '..', 'data', 'real')
const types: Record<string, string> = { '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json', '.webp': 'image/webp' }
function realImagery(): Plugin {
  const serve = (req: { url?: string }, res: import('node:http').ServerResponse, next: () => void) => {
    const url = (req.url ?? '').split('?')[0]
    if (!url.startsWith('/real/')) return next()
    const file = normalize(join(realDir, decodeURIComponent(url.slice(6))))
    if (!file.startsWith(realDir) || !existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404
      return res.end('not fetched, run python scripts/fetch-real-imagery.py')
    }
    res.setHeader('content-type', types[extname(file)] ?? 'application/octet-stream')
    res.setHeader('cache-control', 'no-cache')
    // the splat loader sizes its buffer from this
    res.setHeader('content-length', String(statSync(file).size))
    createReadStream(file).pipe(res)
  }
  return {
    name: 'real-imagery',
    configureServer: (s) => void s.middlewares.use(serve),
    configurePreviewServer: (s) => void s.middlewares.use(serve),
  }
}

export default defineConfig({
  plugins: [react(), realImagery()],
  server: { port: 5710, strictPort: true, host: true, proxy },
  preview: { port: 5710, strictPort: true, host: true, proxy },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: { main: resolve(__dirname, 'index.html'), proof: resolve(__dirname, 'proof.html') },
      output: { manualChunks: { three: ['three'], r3f: ['@react-three/fiber', '@react-three/drei', '@react-three/postprocessing', 'postprocessing'] } },
    },
  },
})

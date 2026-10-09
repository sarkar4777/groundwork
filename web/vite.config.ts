import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const sim = process.env.SIM_URL || 'http://localhost:8710'
const proxy = {
  '/sim': { target: sim, changeOrigin: true, ws: true, rewrite: (p: string) => p.replace(/^\/sim/, '') },
}

export default defineConfig({
  plugins: [react()],
  server: { port: 5710, strictPort: true, host: true, proxy },
  preview: { port: 5710, strictPort: true, host: true, proxy },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: { manualChunks: { three: ['three'], r3f: ['@react-three/fiber', '@react-three/drei', '@react-three/postprocessing', 'postprocessing'] } },
    },
  },
})

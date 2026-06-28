import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Standalone web build of the renderer (NOT electron-vite). Produces a plain SPA
// in dist-web/ that installs the WebAxiClient and runs in a browser. The renderer
// already talks to the injected `client` seam, so the same App + components are
// reused unchanged. Tailwind/PostCSS are picked up from the repo-root configs.
export default defineConfig({
  root: resolve(__dirname, 'src/web'),
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'dist-web'),
    emptyOutDir: true
  },
  server: {
    port: 5293,
    strictPort: false
  }
})

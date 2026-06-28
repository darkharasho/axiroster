import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Standalone web build of the renderer (NOT electron-vite). Produces a plain SPA
// in dist-web/ that installs the WebAxiClient and runs in a browser. The renderer
// already talks to the injected `client` seam, so the same App + components are
// reused unchanged. Tailwind/PostCSS are picked up from the repo-root configs.
export default defineConfig({
  root: resolve(__dirname, 'src/web'),
  // Load .env from the repo root (not the src/web root), so the existing
  // VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are picked up automatically. Only
  // VITE_-prefixed vars are exposed to the bundle, so the other secrets in .env
  // (service-role key, Discord secret) are never shipped to the browser.
  envDir: __dirname,
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

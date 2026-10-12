import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ── BLACKBOX Vite Configuration ───────────────────────────────────────────
//
// Service Worker note:
//   client/public/sw.js is copied to the build root by Vite automatically
//   (all files in public/ are served at the root path with no hashing).
//   This means /sw.js is always available at exactly that path in both
//   development and production — no plugin or extra config is required.
//
//   The SW is registered ONLY in production builds (import.meta.env.PROD).
//   Vite dev server (npm run dev) intentionally skips SW registration to
//   prevent stale-cache interference with HMR.
//
//   To test Service Worker behaviour:
//     npm run build
//     npm run preview
//     Open http://localhost:4173
// ─────────────────────────────────────────────────────────────────────────

export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,
    proxy: {
      // Proxy /api requests to the Express backend during development.
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },

  preview: {
    // Consistent port for production preview — makes SW testing predictable.
    // Open http://localhost:4173 after running: npm run build && npm run preview
    port: 4173,
    strictPort: false,
  },

  build: {
    // Emit source maps for easier debugging during development.
    // Can be set to false before deploying to production.
    sourcemap: false,
  },
})

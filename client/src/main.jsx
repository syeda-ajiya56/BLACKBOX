import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles/tokens.css'
import './styles/globals.css'
import { registerServiceWorker } from './serviceWorkerRegistration.js'
import useAppStore from './store/appStore.js'

// ── Service Worker registration ───────────────────────────────────────────
registerServiceWorker({
  onOfflineReady: () => {
    useAppStore.getState().setSwReady(true)
  },
  onUpdate: () => {
    console.log('[SW] New version available.')
  },
})

// ── Catch uncaught errors and render them on screen ───────────────────────
window.addEventListener('unhandledrejection', (e) => {
  console.error('[BLACKBOX] Unhandled promise rejection:', e.reason)
})

try {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
} catch (err) {
  console.error('[BLACKBOX] Fatal render error:', err)
  document.getElementById('root').innerHTML = `
    <div style="background:#0d0d14;color:#e8e8f4;font-family:monospace;padding:2rem;min-height:100vh;">
      <h2 style="color:#ff3355;margin-bottom:1rem;">⚠ BLACKBOX — Startup Error</h2>
      <p style="color:#ffaa00;">${err.message}</p>
      <pre style="color:#8888aa;font-size:0.75rem;white-space:pre-wrap;">${err.stack ?? ''}</pre>
    </div>`
}

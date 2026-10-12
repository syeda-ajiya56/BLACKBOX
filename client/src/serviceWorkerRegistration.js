// ============================================================
// BLACKBOX — Service Worker Registration
//
// REGISTRATION STRATEGY:
//   - In PRODUCTION (npm run build → npm run preview):
//     The SW registers immediately on page load.
//     This is the primary test environment.
//
//   - In DEVELOPMENT (npm run dev):
//     Vite's HMR and the SW can conflict — a stale SW cache
//     can serve old assets during active development, making
//     changes appear not to take effect.
//     Therefore the SW is intentionally NOT registered in dev.
//     To test SW behaviour, always use the production preview:
//       npm run build && npm run preview
//
// SERVICE WORKER FILE:
//   /sw.js — served from client/public/sw.js by Vite.
//   This path never changes regardless of hashed asset names.
//
// ERROR SAFETY:
//   Registration failures never crash the app.
//   If the browser does not support Service Workers, BLACKBOX
//   continues working normally using IndexedDB directly.
// ============================================================

const SW_URL = '/sw.js'

// Static import — flush is only *called* inside the SW message handler,
// never at module load time. This avoids the Rollup dynamic-import warning.
import { flush as syncEngineFlusher } from './sync/syncEngine.js'

/**
 * registerServiceWorker(callbacks)
 *
 * Registers /sw.js and calls optional lifecycle callbacks.
 *
 * callbacks:
 *   onSuccess(registration) — called when a new SW activates
 *   onUpdate(registration)  — called when an updated SW is waiting
 *   onOfflineReady()        — called when shell is confirmed cached
 */
export function registerServiceWorker({
  onSuccess    = () => {},
  onUpdate     = () => {},
  onOfflineReady = () => {},
} = {}) {
  // Do not register in Vite dev server — see header comment.
  if (import.meta.env.DEV) {
    console.log('[SW] Skipping registration in development mode. Use npm run build + npm run preview to test.')
    return
  }

  if (!('serviceWorker' in navigator)) {
    console.warn('[SW] Service Workers are not supported in this browser. Offline shell will not be available.')
    return
  }

  // Defer registration until after first paint so it does not
  // compete with the critical rendering path.
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(SW_URL, { scope: '/' })
      .then((registration) => {
        console.log('[SW] Registered — scope:', registration.scope)

        // ── Detect state of newly registered SW ──────────────
        if (registration.installing) {
          console.log('[SW] Installing…')
          trackInstallation(registration.installing, onSuccess, onOfflineReady)
        } else if (registration.waiting) {
          console.log('[SW] Waiting — new version ready.')
          onUpdate(registration)
        } else if (registration.active) {
          console.log('[SW] Already active.')
          onSuccess(registration)
          onOfflineReady()
        }

        // ── Detect future updates ─────────────────────────────
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing
          console.log('[SW] Update found — new SW installing.')
          if (newWorker) {
            trackInstallation(newWorker, onSuccess, onOfflineReady)
          }
        })

        // ── Listen for messages from the SW ───────────────────
        // TRIGGER_SYNC is sent by the SW background sync handler.
        // We import syncEngine lazily to avoid a circular module
        // dependency at registration time (SW registers before React mounts).
        navigator.serviceWorker.addEventListener('message', (event) => {
          if (event.data?.type === 'TRIGGER_SYNC') {
            console.log('[SW → App] TRIGGER_SYNC received — calling syncEngine.flush().')
            syncEngineFlusher().catch(console.warn)
          }
        })
      })
      .catch((err) => {
        // Registration failed — app continues to work normally via IndexedDB.
        console.warn('[SW] Registration failed:', err.message)
      })
  })
}

/**
 * trackInstallation(worker, onSuccess, onOfflineReady)
 * Monitors the state of a new SW worker through its lifecycle.
 */
function trackInstallation(worker, onSuccess, onOfflineReady) {
  worker.addEventListener('statechange', () => {
    console.log('[SW] State:', worker.state)

    if (worker.state === 'activated') {
      onSuccess()
      onOfflineReady()
    }
  })
}

/**
 * unregisterServiceWorker()
 * Dev/test utility — call from the browser console if needed:
 *   import('/src/serviceWorkerRegistration.js').then(m => m.unregisterServiceWorker())
 */
export async function unregisterServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  const registrations = await navigator.serviceWorker.getRegistrations()
  for (const reg of registrations) {
    await reg.unregister()
    console.log('[SW] Unregistered:', reg.scope)
  }
}

/**
 * registerBackgroundSync(tag)
 * Requests a Background Sync registration for the given tag.
 * Used by the sync engine (Phase 2D) to register 'blackbox-sync'
 * whenever a write is queued while offline.
 *
 * Safe to call when SyncManager is unsupported — resolves quietly.
 */
export async function registerBackgroundSync(tag = 'blackbox-sync') {
  if (!('serviceWorker' in navigator)) return
  if (!('SyncManager' in window)) {
    console.log('[SW] Background Sync not supported — will rely on online event and manual Sync Now.')
    return
  }

  try {
    const registration = await navigator.serviceWorker.ready
    await registration.sync.register(tag)
    console.log('[SW] Background Sync registered:', tag)
  } catch (err) {
    // Non-fatal: primary sync triggers (online event + manual) remain available.
    console.warn('[SW] Background Sync registration failed:', err.message)
  }
}

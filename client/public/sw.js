// ============================================================
// BLACKBOX — Service Worker
// Version: blackbox-shell-v1
//
// Responsibilities in Phase 2C:
//   1. Cache the application shell (HTML + JS + CSS assets)
//      so BLACKBOX loads offline after first visit.
//   2. Serve cached shell for navigation requests when offline.
//   3. Pass all /api/* requests straight to the network
//      (server sync is Phase 2D — not implemented here).
//   4. Prepare Background Sync event handler (Phase 2D TODO).
//
// What this SW does NOT do:
//   - It does NOT touch IndexedDB data (that is the sync engine's job).
//   - It does NOT process sync_queue items.
//   - It does NOT make any API calls.
//   - It does NOT cache API responses.
// ============================================================

const CACHE_NAME     = 'blackbox-shell-v1'
const OFFLINE_URL    = '/index.html'

// All BLACKBOX cache names — used during activation to prune stale versions.
// When upgrading to v2, add 'blackbox-shell-v2' here and bump CACHE_NAME above.
const KNOWN_CACHES   = ['blackbox-shell-v1']

// ── INSTALL ──────────────────────────────────────────────────
// Cache the app shell. In a Vite build the JS/CSS filenames are
// hashed, so we cache by fetching the index.html and following
// the assets it references at runtime (network-first on first
// load, then cache-first thereafter).
//
// We pre-cache only index.html here; hashed asset files are
// added to the cache dynamically in the fetch handler below
// so we never hard-code build-time filenames.
// ─────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Installing — cache:', CACHE_NAME)

  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        // Pre-cache the app shell entry point.
        // Assets (hashed JS/CSS) are cached on first fetch below.
        return cache.add(OFFLINE_URL)
      })
      .then(() => {
        console.log('[SW] App shell pre-cached.')
        // Take over immediately — do not wait for old SW to stop.
        return self.skipWaiting()
      })
      .catch((err) => {
        console.error('[SW] Install failed:', err)
      })
  )
})

// ── ACTIVATE ─────────────────────────────────────────────────
// Remove any cache versions that are not in KNOWN_CACHES.
// This handles upgrades: when CACHE_NAME changes, old caches
// are deleted so stale assets are not served.
// ─────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating — cleaning old caches.')

  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        const deleteOld = cacheNames
          .filter((name) => name.startsWith('blackbox-') && !KNOWN_CACHES.includes(name))
          .map((name) => {
            console.log('[SW] Deleting stale cache:', name)
            return caches.delete(name)
          })
        return Promise.all(deleteOld)
      })
      .then(() => {
        console.log('[SW] Activated. Taking control of all clients.')
        return self.clients.claim()
      })
  )
})

// ── FETCH ─────────────────────────────────────────────────────
// Routing strategy:
//
//   /api/*            → network only (no caching — Phase 2D)
//   navigation        → network-first, fall back to cached index.html
//   static assets     → cache-first, add to cache on network hit
// ─────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // ── 1. Skip non-GET requests (POST/PUT/DELETE go straight through)
  if (request.method !== 'GET') return

  // ── 2. Skip API requests — server sync is Phase 2D
  if (url.pathname.startsWith('/api/')) return

  // ── 3. Skip cross-origin requests (e.g. CDN fonts not in use)
  if (url.origin !== self.location.origin) return

  // ── 4. Navigation requests (loading the SPA page)
  //        Network-first → fall back to cached index.html (offline shell)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          // Cache the fresh index.html
          if (networkResponse.ok) {
            const clone = networkResponse.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
          }
          return networkResponse
        })
        .catch(() => {
          // Offline — serve the cached shell
          console.log('[SW] Offline navigation — serving cached shell.')
          return caches.match(OFFLINE_URL).then((cached) => {
            if (cached) return cached
            // Should never reach here if install succeeded
            return new Response('<h1>BLACKBOX — Offline</h1>', {
              headers: { 'Content-Type': 'text/html' },
            })
          })
        })
    )
    return
  }

  // ── 5. Static assets (JS, CSS, images, fonts, icons)
  //        Cache-first: serve from cache immediately if available,
  //        otherwise fetch from network and add to cache.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached
      }

      // Not in cache — fetch from network
      return fetch(request)
        .then((networkResponse) => {
          // Only cache successful same-origin responses
          if (
            networkResponse.ok &&
            networkResponse.type === 'basic'
          ) {
            const clone = networkResponse.clone()
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, clone)
            })
          }
          return networkResponse
        })
        .catch((err) => {
          // Asset unavailable offline — nothing useful to return
          console.warn('[SW] Asset unavailable offline:', url.pathname)
          return new Response('', { status: 503 })
        })
    })
  )
})

// ── BACKGROUND SYNC ─────────────────────────────────────────
// Phase 2C: event handler prepared but not yet implemented.
// Phase 2D will implement the actual sync queue flush here.
//
// Background Sync is a supplementary trigger only.
// Primary sync triggers are:
//   - window 'online' event (in syncEngine.js)
//   - manual "Sync Now" button (in syncEngine.js)
// ─────────────────────────────────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'blackbox-sync') {
    console.log('[SW] Background Sync event received: blackbox-sync')

    event.waitUntil(
      // Notify all open BLACKBOX tabs that a background sync fired.
      // Phase 2D: the client-side syncEngine.js will handle the actual
      // IndexedDB sync_queue flush when it receives this message.
      self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then((clients) => {
        if (clients.length === 0) {
          console.log('[SW] Background sync received but no tabs open — sync will run on next tab open.')
          return
        }
        clients.forEach((client) => {
          client.postMessage({ type: 'TRIGGER_SYNC', source: 'background-sync' })
          console.log('[SW] Sent TRIGGER_SYNC to client:', client.id)
        })
      })
      // Phase 2D: process IndexedDB sync_queue here.
      // The SW cannot access IndexedDB directly in a useful way without
      // the full sync engine — the client message approach is preferred
      // so the existing syncEngine.js handles the flush logic.
    )
  }
})

// ── MESSAGE HANDLER ──────────────────────────────────────────
// Allows the React app to communicate with the SW.
// Currently used for:
//   - SKIP_WAITING: force-activate a new SW version during dev
// ─────────────────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[SW] Received SKIP_WAITING — skipping wait.')
    self.skipWaiting()
  }
})

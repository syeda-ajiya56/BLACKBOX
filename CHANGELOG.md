# CHANGELOG

All notable changes to BLACKBOX are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).  
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [0.5.0] — 2026-10-03

### Added — Phase 2E: Conflict Resolution + Two-Device Testing + Audit Log

**Conflict Resolver**
- `client/src/sync/conflictResolver.js` — pure LWW function: `resolveConflict(local, server)` returns `{ winner, loser, rule, reason, resolvedRecord, tieBreak }`
- Rule: `LWW_UPDATED_AT` — later `updatedAt` wins; equal timestamps → lexicographic `deviceId` tie-break
- 14 unit tests in `conflictResolver.test.mjs` — all pass; run with `node src/sync/conflictResolver.test.mjs`

**Conflict Log (upgraded)**
- `client/src/db/conflictLog.js` — full audit entry schema: `resolvedAt`, `rule`, `localSnapshot`, `serverSnapshot`, `winner`, `loser`, `reason`, `resolvedSnapshot`, `deviceId`
- Append-only enforced by `store.add()` (throws on duplicate key)

**Server — Resolve Endpoint**
- `POST /api/incidents/:id/resolve` — accepts LWW-winning record after 409; requires `resolutionToken: true`; server assigns next authoritative `version`; no version equality check applied
- `server/src/routes/incidents.js` — route added
- `server/src/controllers/incidentController.js` — `resolveIncident` controller added
- `client/src/api/client.js` — `resolveIncidentOnServer()` helper added

**Sync Engine (full 409 → resolution workflow)**
- `client/src/sync/syncEngine.js` — `_handleConflict()` implements: LWW decision → audit log → local IDB write → server upload (local win) or server fetch (server win) → mark synced → UI notification
- Anti-loop: `resolutionToken` prevents `/resolve` from triggering a new 409
- Queue item state during resolution: `syncing` → `synced` (success) or `failed` (upload failed)
- `_notifyConflict()` pushes to `activeConflicts` Zustand array → banner renders

**UI**
- `ConflictNotification.jsx` — reports auto-resolved outcome; shows `▲ LOCAL WON` / `▼ SERVER WON`; expandable side-by-side grid with winning field highlighted `★`
- `ConflictLog.jsx` — loads from IDB (no mock data); full audit schema; field diff showing only differing fields; resolved snapshot row; `rule` and `reason` displayed; count shown
- `IncidentDetail.jsx` — conflict history from IDB store; `resolvedAt`, `rule`, `reason` shown; winner snapshot highlighted; backwards-compatible with old schema

**Documentation**
- `docs/architecture.md` — Phase 2E section: full resolution architecture diagram, LWW rule, conflict log schema, anti-loop design, delete-vs-edit, convergence, two-browser setup
- `docs/test-plan.md` — TC-24 through TC-30 + full screenshot evidence checklist
- `docs/scope.md` — conflict resolution behaviour finalised; known limitations table added
- `README.md` — updated with full project description, tech stack, conflict resolution highlight, run commands

### Build
- 98 modules, 0 errors, 0 warnings
- `conflictResolver.test.mjs`: 14/14 unit tests pass

### Known limitations in this version
- LWW depends on client clock accuracy (clock skew documented)
- No authentication
- No real-time WebSocket updates
- Background Sync is supplementary only
- Two devices must reconnect to converge (no push)

---

## [0.4.0] — 2026-10-03

### Added — Phase 2D: Backend API + Sync Engine

**Server**
- `server/src/models/Incident.js` — production Mongoose schema; `version` is server-authoritative; `toJSON` strips `_id`/`__v`; indexes on `status`, `updatedAt`, `deviceId`
- `server/src/controllers/incidentController.js` — full CRUD with:
  - `GET /api/incidents` — list all, optional `?since=` for pull reconciliation
  - `GET /api/incidents/:id` — get one
  - `POST /api/incidents` — idempotent create; server assigns `version = 1`
  - `PUT /api/incidents/:id` — version-checked update; `client version === server version` required; returns `409 VERSION_CONFLICT` with server snapshot when versions differ
  - `DELETE /api/incidents/:id` — soft-delete (status → `closed`) with version check
- `server/src/middleware/errorHandler.js` — Mongoose validation, duplicate-key, and 500 handling
- `server/src/index.js` — CORS (dev + preview origins), health check, route wiring, global error handler
- `server/.env` — local environment (gitignored); `server/.env.example` updated

**Client**
- `client/src/api/client.js` — centralised fetch wrapper: `apiRequest()` with 15s timeout, offline fast-exit, 409 conflict shape; named helpers: `createIncidentOnServer`, `updateIncidentOnServer`, `deleteIncidentOnServer`, `getIncidentFromServer`, `getIncidentsFromServer`, `checkHealth`
- `client/src/sync/syncEngine.js` — full sync engine:
  - `flush()` with concurrency lock (`_flushing`)
  - `_processQueue()` — oldest-first ordering; blocks later mutations for an incident when an earlier one is unresolved
  - `_sendItem()` — dispatches create/update/delete to API, stores server snapshot on 409 for Phase 2E
  - `_pullLatestIncidents()` — reconciles server records into IDB, skips locally-modified incidents
  - `_refreshStoreFromIDB()` — keeps Zustand consistent after flush
  - `registerOnlineListener()` — `window` online event → `flush()`
  - `registerSWMessageListener()` — SW `TRIGGER_SYNC` message → `flush()`
- `client/src/store/appStore.js` — added `syncError` / `setSyncError`
- `client/src/serviceWorkerRegistration.js` — `TRIGGER_SYNC` now calls `syncEngineFlusher()` (static import, no Rollup warning)
- `client/src/components/layout/StatusBar.jsx` — `Sync Now` calls `flush()` directly; shows `Syncing…` spinner, `✗ Sync error` label
- `client/src/components/sync/SyncQueuePanel.jsx` — `Retry Now` resets IDB item then calls `flush()`; `Sync Now` header button calls `flush()`
- `client/src/hooks/useOnlineStatus.js` — registers online listener + SW message listener once (StrictMode guard)

### Verified
- `GET http://localhost:5000/api/health` → HTTP 200 `{"ok":true,"service":"blackbox-api","version":"0.4.0"}`
- MongoDB connects on `mongodb://localhost:27017/blackbox`
- Client build: 97 modules, 0 errors, 0 warnings

### Known limitations in this version
- Conflict resolution (LWW) is NOT implemented — Phase 2E
- Two-device convergence test is NOT implemented — Phase 2E
- The advanced conflict UI (side-by-side diff, winner badge) is placeholder — Phase 2E
- Background Sync remains supplementary (online event + manual Sync Now are primary triggers)

---

## [0.3.0] — 2026-10-03

### Added
- **Service Worker** (`client/public/sw.js`) — production-quality offline app shell
  - Install: pre-caches `index.html`; static assets cached on first fetch
  - Activate: prunes stale `blackbox-shell-*` cache versions
  - Fetch: navigation uses network-first + offline fallback; static assets use cache-first
  - `/api/*` requests pass through to network (server sync is Phase 2D)
  - Background Sync event handler prepared with Phase 2D TODO
  - `SKIP_WAITING` message handler for dev tooling
- **`serviceWorkerRegistration.js`** — safe, production-only registration module
  - Skips registration in Vite dev mode to prevent HMR/cache conflicts
  - `onOfflineReady`, `onSuccess`, `onUpdate` lifecycle callbacks
  - `registerBackgroundSync(tag)` helper exported for Phase 2D sync engine
  - Failures never crash the application
- **`swReady` state** in Zustand store — tracks when shell is confirmed cached
- **`◈ OFFLINE READY` indicator** in StatusBar — shown at 768px+ when SW active
- **`vite.config.js`** updated — `preview.port: 4173` for consistent SW testing URL
- **`docs/architecture.md`** updated — new Service Worker / Offline Shell section
- **`CHANGELOG.md`** updated

### Architecture notes
- SW registration is intentionally skipped in `npm run dev` — test with `npm run build && npm run preview`
- Background Sync is a supplementary trigger only; primary triggers remain the online event and manual Sync Now
- IndexedDB data layer (Phase 2B) is fully preserved and unaffected

---

## [0.2.0] — 2026-10-03

### Added
- Project initialised: BLACKBOX — Offline Incident Intelligence for Ride-Hailing Operations
- `docs/scope.md` — Problem statement, target users, in-scope/out-of-scope features, assumptions, success criteria
- `docs/test-plan.md` — 12 test cases covering offline CRUD, sync, conflict resolution, responsive design
- `docs/architecture.md` — Full system architecture: IndexedDB schema, sync engine, conflict resolution, Service Worker, REST API, two-browser test design
- `CHANGELOG.md` — This file
- Client project scaffold: React + Vite, folder structure for components, db, sync, api, hooks, store, styles
- Server project scaffold: Node.js + Express + Mongoose, folder structure for models, routes, controllers, middleware
- Root `.gitignore` and `README.md`
- Client dependencies installed: react, react-dom, zustand, uuid, vite
- Server dependencies installed: express, mongoose, cors, dotenv, uuid

### Added
- Full IndexedDB data layer (Phase 2B)
  - `db/indexedDB.js` — `openDB` singleton, version-switch upgrade path
  - `db/incidents.js` — atomic CRUD with multi-store transactions (incident + queue in one tx)
  - `db/syncQueue.js` — enqueue, getPending, updateItem, retryItem, countPending
  - `db/conflictLog.js` — append-only conflict audit log
  - `useIncidents` hook — loads IDB on mount, exposes create/update/softDelete/hardDelete/retry
  - `useSyncQueue` hook — reads queue state from Zustand
  - Loading and error states in Dashboard and IncidentForm
  - Mock data removed from production runtime path

---

## [0.1.0] — 2026-10-03

### Added
- Project initialised: BLACKBOX — Offline Incident Intelligence for Ride-Hailing Operations
- Full Phase 2A UI: AppShell, StatusBar, Sidebar, IncidentDashboard, IncidentCard, IncidentForm, IncidentDetail, SyncQueuePanel, ConflictNotification, ConflictLog
- `docs/scope.md`, `docs/test-plan.md`, `docs/architecture.md`, `CHANGELOG.md`
- Client scaffold: React + Vite, Zustand, design tokens, mobile-first CSS (360px base)
- Server scaffold: Node.js + Express + Mongoose stubs

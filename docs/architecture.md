# BLACKBOX — System Architecture

**Project:** BLACKBOX — Offline Incident Intelligence for Ride-Hailing Operations  
**Version:** 1.0.0  
**Date:** October 2026  

---

## Overview

BLACKBOX is an offline-first web application. The client is fully self-sufficient without a network connection. The server is a synchronisation target, not a dependency for core incident management operations.

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                            │
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │   React UI   │◄──►│  IndexedDB   │◄──►│  Sync Engine     │  │
│  │  (Vite)      │    │  blackbox_db │    │  (syncEngine.js) │  │
│  └──────┬───────┘    └──────────────┘    └────────┬─────────┘  │
│         │                                         │            │
│         └───────────────┬─────────────────────────┘            │
│                         │                                      │
│              ┌──────────▼──────────┐                           │
│              │   Service Worker    │                           │
│              │   sw.js             │                           │
│              │ - App shell cache   │                           │
│              │ - Offline intercept │                           │
│              │ - Background Sync   │                           │
│              │   (enhancement)     │                           │
│              └──────────┬──────────┘                           │
└─────────────────────────┼───────────────────────────────────────┘
                          │ HTTPS / localhost (when online)
┌─────────────────────────┼───────────────────────────────────────┐
│              SERVER LAYER│                                       │
│                          │                                      │
│              ┌──────────▼──────────┐                           │
│              │  Express REST API   │                           │
│              │  Node.js            │                           │
│              │  localhost:5000     │                           │
│              └──────────┬──────────┘                           │
│                         │                                      │
│              ┌──────────▼──────────┐                           │
│              │      MongoDB        │                           │
│              │  blackbox database  │                           │
│              │  - incidents        │                           │
│              └─────────────────────┘                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## IndexedDB Schema

Database name: `blackbox_db`  
Current schema version: `1`

### Object Store: `incidents`

Primary key: `id` (UUID string, set by client)

| Field | Type | Description |
|---|---|---|
| `id` | string (UUID) | Client-generated primary key |
| `incidentCode` | string | Human-readable code, e.g. `INC-2026-0042` |
| `rideId` | string | Associated ride identifier |
| `driverName` | string | Full name of the driver |
| `vehicleId` | string | Vehicle plate or identifier |
| `incidentType` | enum string | `collision`, `passenger_dispute`, `breakdown`, `theft`, `medical`, `route_deviation`, `other` |
| `severity` | enum string | `low`, `medium`, `high`, `critical` |
| `description` | string | Free-text description |
| `location` | string | Location at time of incident |
| `status` | enum string | `open`, `under_review`, `resolved`, `closed` |
| `createdAt` | ISO8601 string | Set once at creation, never changed |
| `updatedAt` | ISO8601 string | Updated on every local edit |
| `version` | integer | Incremented on every local edit; server-authoritative after sync |
| `deviceId` | string | Identifier of the originating device (set from localStorage) |
| `syncStatus` | enum string | `pending`, `syncing`, `synced`, `conflict`, `failed` |

Indexes: `syncStatus`, `updatedAt`, `status`

### Object Store: `sync_queue`

Primary key: `queueId` (UUID string)

| Field | Type | Description |
|---|---|---|
| `queueId` | string (UUID) | Primary key |
| `incidentId` | string | Foreign key to `incidents.id` |
| `operation` | enum string | `create`, `update`, `delete` |
| `payload` | object | Full incident snapshot at time of mutation |
| `timestamp` | ISO8601 string | When the queue item was created |
| `attempts` | integer | Number of sync attempts made |
| `status` | enum string | `pending`, `syncing`, `synced`, `conflict`, `failed` |
| `errorMessage` | string \| null | Last error from the server |

Indexes: `incidentId`, `status`

### Object Store: `conflict_log`

Primary key: `conflictId` (UUID string)  
This store is append-only. Records are never deleted.

| Field | Type | Description |
|---|---|---|
| `conflictId` | string (UUID) | Primary key |
| `incidentId` | string | Which incident caused the conflict |
| `detectedAt` | ISO8601 string | When the conflict was detected on this client |
| `localRecord` | object | Full snapshot of the local record at conflict time |
| `serverRecord` | object | Full snapshot of the server record returned in the 409 |
| `winner` | enum string | `local` or `server` |
| `resolution` | string | Human-readable explanation, e.g. `"Local record won: updatedAt 2026-10-03T14:03:21Z > 2026-10-03T14:01:05Z"` |

---

## Sync Engine

**File:** `client/src/sync/syncEngine.js`

The sync engine is the core of BLACKBOX's offline-first behaviour. It is a standalone module — not tied to any React component — so it can be triggered from multiple entry points.

### Trigger Entry Points

1. **`window` online event** — primary trigger; fires when the browser detects network restoration.
2. **Manual "Sync Now" button** — calls `syncEngine.flush()` directly; reliable regardless of online event timing.
3. **Service Worker Background Sync** — the SW registers a `blackbox-sync` tag; on receiving the `sync` event the SW posts a message to the client tab which calls `syncEngine.flush()`. This is a supplementary enhancement — if Background Sync is unsupported or the tab is not open, the next online event or manual trigger will handle it.

### Flush Loop

```
syncEngine.flush():
  if (already flushing) return   ← prevent concurrent runs

  items = getQueueItems(status: 'pending')
  sort by timestamp ascending

  for each item:
    mark item status = 'syncing'
    update incident syncStatus = 'syncing'

    response = await pushToServer(item)

    if response.ok:
      mark item status = 'synced'
      update incident syncStatus = 'synced'
      update incident version with server-returned version

    else if response.status === 409:
      serverRecord = response.body.serverRecord
      resolveConflict(item.payload, serverRecord)

    else if network error or 5xx:
      item.attempts++
      if item.attempts >= 5:
        mark item status = 'failed'
        update incident syncStatus = 'failed'
      else:
        mark item status = 'pending'   ← will retry on next trigger

    update UI via Zustand store

  update lastSyncedAt timestamp
```

### Reconciliation Pull

After a successful flush (all items processed), the sync engine performs a pull step:

```
GET /api/incidents?since=<lastSyncedAt>
```

The server returns all incidents updated since the last pull. The client upserts these into the local `incidents` store — this ensures that records updated by another device (e.g. the winning side of a conflict) are reflected locally.

---

## Conflict Detection and Resolution

### Detection

Every `PUT /api/incidents/:id` request includes the `version` number from the local record at the time of the edit. The server checks:

```javascript
if (incoming.version < serverRecord.version) {
  return res.status(409).json({
    conflict: true,
    serverRecord: serverRecord
  });
}
```

### Resolution — Last-Write-Wins (LWW)

**File:** `client/src/sync/conflictResolver.js`

```javascript
function resolveConflict(localRecord, serverRecord) {
  const localWins = new Date(localRecord.updatedAt) > new Date(serverRecord.updatedAt);
  const winner = localWins ? 'local' : 'server';

  if (localWins) {
    // Force-push: send local record with version = serverRecord.version + 1
    forcePushToServer(localRecord, serverRecord.version + 1);
  } else {
    // Accept server: overwrite local IndexedDB record with server's version
    overwriteLocalRecord(serverRecord);
  }

  // Write to conflict_log regardless of outcome
  writeConflictLog({
    incidentId: localRecord.id,
    localRecord,
    serverRecord,
    winner,
    resolution: buildResolutionString(localRecord, serverRecord, winner)
  });

  // Trigger UI notification
  notifyConflict(incidentId, winner);
}
```

### Post-Resolution Pull

After conflict resolution (win or lose), the client immediately fetches the authoritative server record:

```
GET /api/incidents/:id
```

This ensures the local `incidents` store holds the true final state. The other device will receive this state on its next sync or manual refresh.

### Known Limitation — Clock Skew

LWW relies on client-set `updatedAt` timestamps. If a device's system clock is ahead of other devices (clock skew), it will tend to win conflicts regardless of actual edit order. This is a well-known limitation of LWW strategies in distributed systems.

Mitigations not in scope for this version:
- Server-assigned timestamps (would require server round-trip on every write, breaking offline-first)
- Vector clocks (significantly more complex)
- Hybrid Logical Clocks (HLC)

For this application, clock skew is an accepted limitation. The conflict log makes the winning timestamp explicit so any anomaly is visible to operators.

---

## Service Worker

**File:** `client/public/sw.js`

The Service Worker has three responsibilities:

### 1. App Shell Caching (Offline Navigation)

Strategy: **Cache First** for all static assets.

```
On install:
  Pre-cache: index.html, main JS bundle, main CSS bundle, fonts, icons

On activate:
  Delete any cache with a name !== CACHE_NAME (removes stale versions)

On fetch (non-API requests):
  Try cache first
  If miss: try network, then store in cache
  If both fail: return fallback offline page
```

Cache name: `blackbox-shell-v1`

### 2. API Request Handling (Offline Intercept)

```
On fetch (requests matching /api/*):
  Try network
  If network fails (offline):
    Return JSON: { offline: true, message: "Device is offline. Changes will sync when connection is restored." }
```

The sync engine — not the Service Worker — handles queuing. The SW only signals that the device is offline so the client can show the correct UI state.

### 3. Background Sync (Enhancement)

```
When sync engine queues a write:
  navigator.serviceWorker.ready.then(sw => sw.sync.register('blackbox-sync'))

On SW sync event (tag: 'blackbox-sync'):
  Post message to client tab: { type: 'TRIGGER_SYNC' }
  Client receives message → calls syncEngine.flush()
```

Background Sync is **not** the primary sync mechanism. It is a convenience that handles the edge case where the browser regains connectivity while the tab is open but unfocused. The online event listener and manual Sync Now button are the primary, always-reliable triggers.

---

## REST API

**Base URL:** `http://localhost:5000/api`

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/incidents` | List all incidents. Accepts `?since=<ISO8601>` for pull reconciliation |
| `GET` | `/incidents/:id` | Get a single incident by ID |
| `POST` | `/incidents` | Create a new incident |
| `PUT` | `/incidents/:id` | Update an incident. Returns `409` if version conflict |
| `DELETE` | `/incidents/:id` | Soft-delete (sets status to `closed`) |

### Version Conflict Response (409)

```json
{
  "conflict": true,
  "message": "Version conflict detected",
  "serverRecord": { ...full server record... }
}
```

---

## Device Identity

**File:** `client/src/sync/deviceId.js`

On first load, the app checks `localStorage` for a `blackbox_device_id`. If absent, it generates a UUID and stores it. This value is included in every incident record as `deviceId` and in every sync request header as `X-Device-Id`.

This is sufficient for the two-browser conflict demonstration: Chrome and Chrome Incognito maintain separate `localStorage` namespaces, giving each a distinct device identity.

---

## Two-Browser Conflict Test Architecture

```
Browser A (Chrome)                    Browser B (Chrome Incognito)
deviceId: aaa-111                     deviceId: bbb-222

[ Both online — fetch same record from server ]
  incident: { id: X, version: 5, status: "open" }

[ Both go offline ]

[ Browser A edits description ]        [ Browser B edits severity ]
  version: 6, updatedAt: T1              version: 6, updatedAt: T2 (T2 > T1)

[ Browser A goes online first ]
  PUT /api/incidents/X { version: 6 }
  Server: version 5 on disk → 6 incoming → ACCEPT
  Server now: version: 6, updatedAt: T1

[ Browser B goes online ]
  PUT /api/incidents/X { version: 6 }
  Server: version 6 on disk → 6 incoming → CONFLICT (409)
  Server returns: { conflict: true, serverRecord: { version: 6, updatedAt: T1 } }

[ Browser B conflict resolution ]
  T2 > T1 → Browser B wins
  Force-push: PUT /api/incidents/X { version: 7, updatedAt: T2 }
  Server now: version: 7, updatedAt: T2 (Browser B's edit)

[ Pull reconciliation ]
  Browser B: GET /api/incidents/X → confirms version 7
  Browser A: next sync pull → GET /api/incidents?since=T1 → receives version 7
  Both browsers now show version 7 with Browser B's severity edit
```

---

## Technology Stack

| Layer | Technology | Version | Justification |
|---|---|---|---|
| Frontend framework | React | 18.x | Component model fits panel-heavy operations UI |
| Build tool | Vite | 5.x | Fast HMR, straightforward SW integration |
| State management | Zustand | 4.x | Minimal boilerplate; easy to wire with IndexedDB reads |
| Styling | Custom CSS + design tokens | — | Full control over dark ops aesthetic |
| IDB access | Raw IndexedDB API | Browser built-in | Demonstrates genuine understanding; no wrapper library dependency |
| Backend framework | Express | 4.x | Minimal, well-understood REST server |
| ODM | Mongoose | 8.x | Schema validation + version field support |
| Database | MongoDB | 7.x | Document model fits incident shape |

---

## Security Considerations (Out of Scope for v1)

- No authentication in v1 (out of scope per assignment requirements)
- CORS restricted to `localhost` origins in development
- No sensitive data transmitted; all data is fictional test incidents
- Production hardening (HTTPS, auth, rate limiting) would be required before real deployment

---

## Service Worker / Offline Shell

*Added in Phase 2C.*

### Why the Service Worker exists

BLACKBOX must be usable offline. IndexedDB stores the application **data** (incidents, sync queue, conflict log) — but a database is useless if the application shell itself cannot load without a network connection. The Service Worker solves this by caching the HTML, JavaScript, and CSS bundles so the browser can reconstruct the full UI from local storage alone.

These are two separate offline layers with distinct responsibilities:

| Layer | Technology | Stores |
|---|---|---|
| Application data | IndexedDB | incidents, sync_queue, conflict_log |
| Application shell | Service Worker + Cache Storage | index.html, JS bundle, CSS bundle |

Neither layer can replace the other.

### What the Service Worker caches

**Cache name:** `blackbox-shell-v1`

On **install**: `index.html` is pre-cached. This is the only file that can be reliably named at install time — Vite's production build hashes all JS and CSS filenames (e.g. `index-Df-EMMKn.js`).

On **first fetch**: all same-origin GET responses for JS, CSS, fonts, and icons are added to the cache dynamically as the browser requests them. After the first full page load, the complete shell is available offline.

### Fetch strategy

| Request type | Strategy | Rationale |
|---|---|---|
| Navigation (`/`, `/index.html`) | Network-first → offline fallback | Always try to serve fresh HTML; fall back to cache when offline |
| Static assets (JS, CSS, fonts) | Cache-first → network fallback | Hashed filenames never change; cache is always valid |
| `/api/*` requests | Network only (pass-through) | Server sync is Phase 2D — not cached here |
| Cross-origin requests | Pass-through | Not applicable in this deployment |
| Non-GET requests | Pass-through | POST/PUT/DELETE are never cached |

### Cache versioning

The cache name `blackbox-shell-v1` is defined as a constant in `sw.js`. A separate array `KNOWN_CACHES` lists all valid version names.

On **activate**, the SW deletes any cache whose name starts with `blackbox-` but is not in `KNOWN_CACHES`. To upgrade:
1. Increment `CACHE_NAME` to `blackbox-shell-v2`
2. Add `'blackbox-shell-v2'` to `KNOWN_CACHES`
3. Deploy — the old `v1` cache is deleted automatically after the new SW activates.

### Service Worker registration

**File:** `client/src/serviceWorkerRegistration.js`

Registration is intentionally **production-only** (`import.meta.env.PROD`). In Vite dev mode (`npm run dev`), the SW is not registered because HMR and a caching SW conflict — stale cached assets can obscure code changes during active development.

**To test SW behaviour**, always use the production preview:
```bash
cd client
npm run build
npm run preview
# Open http://localhost:4173
```

Registration is deferred to the `load` event so it does not compete with the critical rendering path. Failures are caught and logged — they never crash the React application.

When the SW activates and the shell is confirmed cached, the `onOfflineReady` callback fires, which sets `swReady: true` in the Zustand store. The StatusBar then shows a small `◈ OFFLINE READY` indicator (visible at tablet and desktop widths).

### Background Sync preparation

The SW registers a `sync` event handler for the tag `blackbox-sync`. In Phase 2C this handler:
1. Detects the background sync event
2. Posts a `{ type: 'TRIGGER_SYNC' }` message to all open client tabs
3. Logs a Phase 2D TODO

**Background Sync is a supplementary enhancement, not the primary sync mechanism.** The Phase 2D sync engine will use three triggers in priority order:
1. `window` online event — fires as soon as network is restored
2. Manual "Sync Now" button — user-triggered, always reliable
3. Background Sync API — fires when the browser regains connectivity even if the tab was backgrounded (supported in Chrome/Edge; not in all browsers)

`registerBackgroundSync(tag)` is exported from `serviceWorkerRegistration.js` for use by the Phase 2D sync engine.

### Why API synchronisation is deferred to Phase 2D

The Service Worker in Phase 2C does not process any `sync_queue` entries. Processing the queue requires:
- The Express REST API to be running
- Version conflict detection logic (the `409` handler)
- The LWW conflict resolver
- Atomic IndexedDB updates post-sync

Attempting to implement partial sync in the SW would produce untestable, half-working behaviour. Phase 2D implements the complete sync engine as a standalone client-side module (`syncEngine.js`) which is cleanly triggered by the three mechanisms above.

### Known limitations

- The offline shell is only available **after the first visit** — the SW must install and activate at least once while online.
- Clock skew affects LWW conflict resolution (see Conflict Detection section).
- Background Sync is not supported in all browsers (Safari, Firefox as of 2026). The online event and manual Sync Now button cover these cases.

---

## Phase 2D — Backend API + Synchronisation

*Added in Phase 2D.*

### Express REST API

**Base URL:** `http://localhost:5000/api`  
**File:** `server/src/index.js`

CORS is configured to allow the Vite dev origin (`localhost:5173`) and the production preview (`localhost:4173`). All allowed origins are listed in `DEFAULT_ORIGINS` and can be extended via `ALLOWED_ORIGINS` in `.env`.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Liveness check — returns `{ ok, service, version, timestamp }` |
| `GET` | `/api/incidents` | List all incidents. `?since=<ISO8601>` filters to records updated after that time (used for pull reconciliation) |
| `GET` | `/api/incidents/:id` | Fetch one incident by client UUID |
| `POST` | `/api/incidents` | Create a new incident. Server assigns `version = 1`. Idempotent — returns existing record if `id` already exists |
| `PUT` | `/api/incidents/:id` | Update incident. Requires `version` field matching server's current version. Returns `409 VERSION_CONFLICT` on mismatch |
| `DELETE` | `/api/incidents/:id` | Soft-delete — sets `status = "closed"`, increments `version`. Includes version check |

### Server-Authoritative Versioning

`version` is controlled by the server after the first sync:

- **On `POST`:** server sets `version = 1` regardless of what the client sends.
- **On `PUT`:** client must send its last-known server version (`version` field in the request body). If `client.version === server.version`, the update is accepted and `server.version` is incremented. If they differ, the server returns:

```json
{
  "success": false,
  "error": "VERSION_CONFLICT",
  "serverIncident": { ...full server record... },
  "clientVersion": 2,
  "serverVersion": 4
}
```

The client stores the `serverIncident` snapshot on the queue item for Phase 2E (LWW resolution). No automatic winner selection happens in Phase 2D.

### MongoDB Schema

Collection: `incidents`  
Model: `server/src/models/Incident.js`

Key design decisions:
- `id` is the client-generated UUID, stored as a string with a unique index. MongoDB's `_id` is internal and never sent to the client.
- `createdAt` / `updatedAt` are ISO8601 strings set by the client. The server does not override them.
- `version` is a positive integer, always at least 1.
- `toJSON` transform removes `_id` and `__v` from all API responses.

### Client API Module

**File:** `client/src/api/client.js`

All network calls go through `apiRequest(method, path, body)`. No `fetch()` calls appear in React components or the sync engine directly.

The function:
1. Fast-exits with `{ offline: true }` if `navigator.onLine` is false.
2. Sets a 15-second `AbortController` timeout.
3. Returns a structured result object — never throws.
4. Handles 409 separately, returning `{ conflict: true, serverIncident, clientVersion, serverVersion }`.

Named helpers (`createIncidentOnServer`, `updateIncidentOnServer`, etc.) wrap `apiRequest` with the correct method and path.

### Sync Engine

**File:** `client/src/sync/syncEngine.js`

The sync engine is a standalone module — not a React component — so it can be triggered from three independent entry points:

| Trigger | Entry point | Notes |
|---|---|---|
| Browser `online` event | `registerOnlineListener()` | Primary — fires automatically on network restoration |
| Manual "Sync Now" button | `flush()` direct call | Primary — always reliable |
| SW Background Sync message | `registerSWMessageListener()` | Supplementary — enhancement for backgrounded tabs |

**`flush()` algorithm:**

```
if (already flushing) → return early (concurrency lock)
if (offline) → return early

set isSyncing = true, syncError = null

_processQueue():
  read all 'pending' items from IDB, sorted oldest-first
  for each item:
    if (incident has a blocked earlier item) → skip
    mark item 'syncing' in IDB + Zustand
    _sendItem(item):
      POST / PUT / DELETE to API
      if success → putIncident(serverRecord), mark 'synced'
      if 409     → store serverSnapshot, mark 'conflict', block incident
      if error   → increment attempts; if >= 5 mark 'failed'; else re-pend
    
_pullLatestIncidents():
  GET /api/incidents?since=lastSyncedAt
  for each server record:
    if incident has no pending local mutations → putIncident (upsert)
    else → skip (do not overwrite pending local changes)

set lastSyncedAt = now
set isSyncing = false

_refreshStoreFromIDB():
  re-read incidents + queue + conflicts from IDB → Zustand
```

**Queue ordering guarantee:** If an incident has a `create` followed by two `update` items in the queue, the `create` must succeed before either `update` is attempted. The `blockedIncidents` Set enforces this within a single flush cycle.

**Conflict behaviour in Phase 2D (detection only):**  
When `PUT` returns 409, the sync engine:
1. Marks `queueItem.status = 'conflict'`
2. Stores `serverIncident` snapshot on the queue item (`serverSnapshot` field)
3. Marks `incident.syncStatus = 'conflict'`
4. Blocks further mutations for that incident in the current flush cycle
5. Does NOT choose a winner, does NOT call LWW resolution

Phase 2E will read the `serverSnapshot` from the queue item and apply Last-Write-Wins.

### Pull / Reconciliation Rule

After every successful flush, `_pullLatestIncidents()` calls `GET /api/incidents?since=<lastSyncedAt>` and upserts returned records into the local `incidents` IDB store.

**Safety rule:** An incident is only overwritten locally if it has **no** queue items with status `pending`, `syncing`, or `conflict`. This ensures that locally-modified incidents that have not yet synced are never silently replaced by an older server version.

### Why Conflict Resolution is Deferred to Phase 2E

Resolving conflicts correctly requires:
1. A clear LWW decision based on `updatedAt` timestamps
2. A force-push mechanism (sending `version = serverVersion + 1` to win)
3. Writing an entry to `conflict_log` IDB store
4. Surfacing the conflict in the UI with a non-dismissible banner
5. A post-resolution pull to confirm both devices converge

Implementing all of this in Phase 2D alongside the initial sync plumbing would make both harder to test in isolation. Phase 2D establishes that detection (409) and queuing (serverSnapshot) work correctly. Phase 2E adds the resolution layer on top of a known-working foundation.

---

## Phase 2E — Conflict Resolution Architecture

*Added in Phase 2E.*

### Overview: Two-Device Conflict Scenario

```
Device A (Chrome)                    Device B (Chrome Incognito)
─────────────────                    ───────────────────────────
deviceId: aaa-111                    deviceId: bbb-222

[ Both online — same incident synced from server ]
  incident: { id: X, version: 1 }

[ Both go OFFLINE ]

[ Device A edits description ]       [ Device B edits severity ]
  updatedAt: T1                        updatedAt: T2  (T2 > T1)
  syncQueue: pending                   syncQueue: pending

[ Device A goes online first ]
  PUT /api/incidents/X { version: 1 }
  Server: version 1 on disk → ACCEPT
  Server: { version: 2, updatedAt: T1 }

[ Device B goes online ]
  PUT /api/incidents/X { version: 1 }
  Server: version 2 on disk → client sent 1 → CONFLICT
  Server returns: 409 VERSION_CONFLICT { serverIncident: { version: 2, updatedAt: T1 } }

[ Device B runs conflict resolution ]
  resolveConflict(localRecord, serverRecord)
  T2 > T1 → Device B (local) wins

  appendConflictEntry() → conflict_log IDB store
  POST /api/incidents/X/resolve { ...Device B fields, resolutionToken: true }
  Server: assigns version 3, returns authoritative record

[ Device B pulls final state ]
  GET /api/incidents/X → { version: 3, updatedAt: T2 }
  putIncident() → IDB updated, syncStatus = synced

[ Device A next sync / pull ]
  GET /api/incidents?since=T_last_sync
  Receives { version: 3, updatedAt: T2 }
  putIncident() → IDB updated
  Both devices now show version 3 with Device B's severity edit
```

### Conflict Rule: Last-Write-Wins (LWW_UPDATED_AT)

**File:** `client/src/sync/conflictResolver.js`

The resolver is a **pure function** — no database writes, no API calls, no side-effects.

```
resolveConflict(localRecord, serverRecord) → ConflictDecision

Decision algorithm:
  if localRecord.updatedAt > serverRecord.updatedAt:
      winner = 'local'
      reason = "Local record won: updatedAt HH:mm:ss > HH:mm:ss (Last-Write-Wins)"

  elif serverRecord.updatedAt > localRecord.updatedAt:
      winner = 'server'
      reason = "Server record won: updatedAt HH:mm:ss > HH:mm:ss (Last-Write-Wins)"

  else (equal timestamps):
      winner = lexicographically greater deviceId
      reason = "Timestamps equal; deviceId tie-break"
      tieBreak = true

Returns:
  { winner, loser, rule, reason, resolvedRecord, localUpdatedAt, serverUpdatedAt, tieBreak }
```

**Unit tests:** 14 cases in `conflictResolver.test.mjs` — all pass.

### Known Limitation: Clock Skew

LWW relies on client-set `updatedAt` timestamps. If a device's system clock is ahead of other devices, its records will tend to win LWW comparisons regardless of actual edit order. This is a documented, accepted limitation.

Mitigations not in scope for this version:
- Server-assigned timestamps (requires server round-trip on write — breaks offline-first)
- Vector clocks (significantly more complex)
- Hybrid Logical Clocks (HLC)

The conflict log makes the winning timestamps explicit, so any anomaly caused by clock skew is visible to operators.

### Conflict Audit Log

**IDB store:** `conflict_log` (append-only)  
**File:** `client/src/db/conflictLog.js`

Every conflict event produces one immutable entry. Entries are never edited or deleted.

| Field | Description |
|---|---|
| `conflictId` | UUID — primary key |
| `incidentId` | Which incident conflicted |
| `detectedAt` | ISO8601 — when the 409 was received |
| `resolvedAt` | ISO8601 — when LWW resolution completed (same flush cycle) |
| `rule` | `'LWW_UPDATED_AT'` |
| `localSnapshot` | Full incident state from local IndexedDB at conflict time |
| `serverSnapshot` | Full incident state from the 409 server response |
| `winner` | `'local'` or `'server'` |
| `loser` | `'server'` or `'local'` |
| `reason` | Human-readable LWW decision explanation |
| `resolvedSnapshot` | The winning record's fields (what was uploaded to server) |
| `deviceId` | Device that detected and resolved this conflict |

### Full 409 Resolution Workflow (syncEngine._handleConflict)

```
409 received from PUT /api/incidents/:id
   ↓
1. Capture localIncident from IDB (current local state)
   Capture serverIncident from 409 response body
   ↓
2. resolveConflict(localIncident, serverIncident) → pure LWW decision
   ↓
3. appendConflictEntry() → immutable IDB conflict_log entry
   ↓
4a. If winner === 'local':
      POST /api/incidents/:id/resolve { ...resolvedRecord, resolutionToken: true }
      Server assigns next authoritative version (serverVersion + 1)
      Returns { incident: authoritativeRecord }
   ↓
4b. If winner === 'server':
      GET /api/incidents/:id → fetch current authoritative state
   ↓
5. putIncident(authoritativeRecord) → overwrite IDB with final state
   syncStatus = 'synced'
   ↓
6. updateQueueItem(queueId, { status: 'synced' })
   ↓
7. _notifyConflict() → pushes entry to Zustand activeConflicts
   UI renders ConflictNotification banner
   ↓
8. _pullLatestIncidents() → other device gets version on next sync
```

### Anti-Loop Protection

The `/resolve` endpoint requires `resolutionToken: true` in the request body. Normal `PUT` requests never include this. This ensures:
- `/resolve` is never called on a normal update
- The server does not apply version equality checking on `/resolve` calls
- The server still assigns the next authoritative version — it never accepts a client-chosen version number
- A resolved conflict cannot immediately re-trigger a 409

### Server Resolve Endpoint

```
POST /api/incidents/:id/resolve
Body: { ...winningFields, resolutionToken: true, winner: 'local'|'server' }

Server behaviour:
  1. Reject if resolutionToken !== true → 400
  2. Find current server record
  3. Apply writable fields from request body
  4. Set version = serverRecord.version + 1
  5. Return updated authoritative record
```

### Delete-vs-Edit Edge Case

When Device A closes an incident (soft-delete, `status: 'closed'`) while Device B edits its description offline, both produce a mutation in `sync_queue`. The same LWW rule applies:

- The version check on `DELETE /api/incidents/:id` triggers a 409 if another device updated first
- `_handleConflict` compares `updatedAt` timestamps as normal
- The winner's final `status` field is preserved — if the closer's `updatedAt` is later, the incident is `closed`; if the editor's `updatedAt` is later, the incident retains the edited fields

No special hidden rule is used — LWW_UPDATED_AT applies uniformly.

### Convergence

After conflict resolution, both devices converge when:
1. Device B (resolver) writes the authoritative record to IDB after `/resolve`
2. Device A receives the updated record via `_pullLatestIncidents()` on its next sync
3. Both IDB stores contain the same record: same `version`, same `updatedAt`, same field values

The `deviceId` fields in each device's local copy may differ (reflecting which device last wrote locally), but all incident data fields are identical.

### Two-Browser Test Setup

| Detail | Value |
|---|---|
| Device A | Chrome normal window — `http://localhost:5173` |
| Device B | Chrome Incognito — `http://localhost:5173` |
| Separation | Chrome and Incognito maintain separate `localStorage` → separate `deviceId` |
| Server | `http://localhost:5000` — shared by both |
| Offline simulation | DevTools → Network → Offline (per-tab, independent) |

Follow TC-24 in `docs/test-plan.md` for the step-by-step procedure.

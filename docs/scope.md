# BLACKBOX — Project Scope

**Project:** BLACKBOX — Offline Incident Intelligence for Ride-Hailing Operations  
**Version:** 1.0.0  
**Date:** October 2026  

---

## Problem Statement

Ride-hailing operations depend on accurate, timely incident reporting. Drivers and dispatchers operate in environments with unreliable or intermittent internet connectivity — tunnels, rural routes, network outages, and high-congestion events. When connectivity drops, existing web-based systems either fail silently or prevent the user from recording anything at all.

BLACKBOX solves this by treating offline as the default mode. Incident records are created and edited locally in the browser using IndexedDB, queued for synchronization, and pushed to the server the moment connectivity returns. Conflicts arising from two devices editing the same record offline are detected, resolved transparently using a Last-Write-Wins strategy, and logged for audit purposes.

---

## Target Users

| Role | Description |
|---|---|
| Driver | Records incidents from a mobile device during or after a ride |
| Dispatcher / Supervisor | Reviews, updates, and closes incidents from a desktop or tablet |
| Operations Analyst | Reviews incident history and conflict logs for patterns |

Primary device for drivers: mobile (360px–480px viewport).  
Primary device for dispatchers: tablet or desktop (768px–1440px viewport).

---

## In-Scope Features

### Incident Management
- Create a new incident record offline or online
- Edit an existing incident record offline or online
- View incident details including full change metadata
- Delete an incident (soft delete — marked closed, not removed from history)
- Incident fields: `id`, `incidentCode`, `rideId`, `driverName`, `vehicleId`, `incidentType`, `severity`, `description`, `location`, `status`, `createdAt`, `updatedAt`, `version`, `deviceId`, `syncStatus`

### Offline Capability
- Full CRUD operations available with no network connection
- All writes persisted immediately to IndexedDB
- Application shell served from Service Worker cache (navigable offline)
- Clear online/offline status indicator visible at all times

### Synchronization
- Sync queue with visible states: `pending`, `syncing`, `synced`, `conflict`, `failed`
- Primary sync triggers: browser `online` event and manual "Sync Now" button
- Background Sync API used as a supplementary trigger (enhancement, not a dependency)
- Automatic retry on reconnection (up to 5 attempts per queue item)
- Manual "Retry Now" action for `failed` queue items
- Last successful sync timestamp displayed in the UI

### Conflict Detection and Resolution
- Version-checked writes: server returns `409 Conflict` when incoming version is stale
- Last-Write-Wins resolution based on `updatedAt` timestamp comparison
- Pull/reconciliation step after resolution: client fetches server's final record to converge
- Conflict log: every conflict event recorded in `conflict_log` IndexedDB store
- Conflict notification displayed in UI — non-dismissible until acknowledged
- Conflict Log panel showing local snapshot, server snapshot, winner, and resolution reason
- Known limitation documented: client clock skew can affect LWW correctness (see architecture.md)

### Sync Queue Visualisation
- Dedicated Sync Queue panel listing all queue items with status, timestamp, and attempt count
- "Retry Now" button for items in `failed` state
- Queue cleared on successful sync

### Responsive Design
- Mobile-first layout starting at 360px
- Responsive breakpoints at 768px (tablet) and 1440px (desktop)
- No functionality degraded at any supported viewport

### Documentation
- `docs/scope.md` — this file
- `docs/test-plan.md` — 10+ test cases
- `docs/architecture.md` — full system design
- `CHANGELOG.md` — version history

---

## Out-of-Scope Features

The following are explicitly excluded from this version:

| Feature | Reason for Exclusion |
|---|---|
| User authentication / login | Out of scope for this assignment; would require auth flows that distract from the offline-sync focus |
| Role-based access control | Dependent on authentication |
| Real-time notifications (WebSockets, SSE) | Not required; sync is pull-based and event-triggered |
| Maps / GPS tracking | No geospatial requirement in the incident model |
| Push notifications | Platform-specific; out of scope |
| Photo/file attachments | Binary sync adds complexity beyond assignment scope |
| AI-generated summaries or classification | Not required |
| Payment processing | Not applicable to incident management |
| Multi-tenancy / fleet management | Single-fleet scope |
| Native mobile application | Web application only |
| Email or SMS alerts | No communication layer in scope |

---

## Assumptions

1. The application runs in a modern browser that supports IndexedDB, Service Workers, and the Fetch API (Chrome 90+, Firefox 90+, Edge 90+).
2. The server is accessible on a local network or localhost during testing; production deployment is not required for the assignment.
3. Each browser instance (device) generates a unique `deviceId` on first load, stored in `localStorage`. This is sufficient for the two-device conflict test.
4. Client clocks may drift. The LWW strategy relies on client-set `updatedAt` values, which means a device with a fast clock will tend to win conflicts regardless of actual intent. This is documented as a known limitation and is acceptable for this scope.
5. Soft-deleted incidents are excluded from sync queue processing after deletion.
6. MongoDB is running locally (`mongodb://localhost:27017/blackbox`) during development.
7. The Express server runs on `localhost:5000` and the Vite dev server proxies `/api` requests to it.
8. No data migration strategy is needed for this initial version.

---

## Success Criteria

| Criterion | Verification Method |
|---|---|
| Incidents can be created and edited with no network connection | DevTools Network → Offline; create/edit record; confirm in IndexedDB viewer |
| All writes persist in IndexedDB immediately | DevTools → Application → IndexedDB → blackbox_db → incidents |
| Sync queue shows correct state transitions | Sync Queue panel in UI; DevTools IndexedDB |
| Records sync to MongoDB on reconnection | MongoDB Compass or `db.incidents.find()` after going online |
| Conflict is detected when two devices edit the same record offline | Two-browser test procedure (see test-plan.md TC-07) |
| LWW resolution picks the record with the later `updatedAt` | Conflict log in UI and `conflict_log` IDB store |
| Both browsers converge to the same final state after pull | Reload both browsers after sync; compare displayed record |
| Conflict log is persisted and viewable | Conflict Log panel in UI |
| Application is navigable offline (Service Worker) | DevTools → Network → Offline; refresh page; app loads |
| UI is usable at 360px, 768px, and 1440px | Browser DevTools device emulation + screenshots |

---

## Phase 2E Additions and Known Limitations

### Conflict Resolution Behaviour (finalised in Phase 2E)

BLACKBOX automatically resolves sync conflicts using **Last-Write-Wins (LWW)** on the `updatedAt` timestamp. Resolution happens in the same sync flush cycle that detects the conflict — no user decision is required.

**Resolution rule:**
1. Compare `updatedAt` timestamps of the local record and the server record
2. The record with the later timestamp wins
3. If timestamps are equal: the lexicographically greater `deviceId` wins (deterministic tie-break)
4. The winning record is uploaded to the server via `POST /api/incidents/:id/resolve`
5. The server assigns the next authoritative version number
6. Both devices converge on the next sync pull

**Every conflict is logged** in the local `conflict_log` IndexedDB store with full snapshots of both sides, the winner, the reason, and the resolved state.

### Known Limitations (v1.0.0)

| Limitation | Impact | Future mitigation |
|---|---|---|
| LWW relies on client clocks | A device with a fast clock tends to win regardless of actual edit order | Server-assigned timestamps or Hybrid Logical Clocks (HLC) |
| No real-time sync | Convergence requires the second device to explicitly sync (online event, Sync Now, or Background Sync) | WebSocket push notifications |
| No authentication | Any browser can read and write all incidents | JWT auth, role-based access control |
| Single-tenant | All incidents are in one namespace | Multi-tenant architecture |
| Offline shell requires first visit | SW must install before offline navigation works | Pre-caching via build pipeline |
| Background Sync not universal | Not supported in Safari/Firefox as of v1 | Polyfill or server-sent events |
| Clock skew on delete-vs-edit | If a device closes an incident but another device's edit has a later `updatedAt`, the close may be overridden | Operational-type-aware merge rules |

### Explicit Out-of-Scope Items (unchanged)

Authentication, payments, maps, GPS tracking, real-time WebSockets, push notifications, AI features, multi-tenancy, native mobile application, email/SMS alerts — all remain out of scope for BLACKBOX v1.0.0.

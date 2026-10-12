# BLACKBOX — Test Plan

**Project:** BLACKBOX — Offline Incident Intelligence for Ride-Hailing Operations  
**Version:** 1.0.0  
**Date:** October 2026  

---

## Test Environment

| Item | Value |
|---|---|
| Browsers | Chrome 120+ (Device A), Firefox 120+ or Chrome Incognito (Device B) |
| Server | Node.js + Express on `localhost:5000` |
| Database | MongoDB on `localhost:27017/blackbox` |
| Client | Vite dev server on `localhost:5173` |
| Offline simulation | DevTools → Network tab → Offline throttle profile |
| IndexedDB inspection | DevTools → Application → Storage → IndexedDB → `blackbox_db` |

---

## Test Cases

### TC-01 — Offline Incident Creation

**Category:** Offline CRUD  
**Priority:** Critical  

**Preconditions:**
- Application loaded and app shell cached by Service Worker
- DevTools Network set to Offline

**Steps:**
1. Confirm the status bar shows the red OFFLINE indicator
2. Click "New Incident"
3. Fill all required fields (incidentCode, rideId, driverName, vehicleId, incidentType, severity, description, location)
4. Click "Save"

**Expected Results:**
- Incident appears in the dashboard immediately without any network call
- DevTools → IndexedDB → `incidents` store contains the new record with `syncStatus: "pending"`
- DevTools → IndexedDB → `sync_queue` store contains one entry with `status: "pending"` and `operation: "create"`
- Pending sync count in status bar increments by 1
- No error or loading spinner shown

**Evidence to Capture:** Screenshot of dashboard + IndexedDB `incidents` store + sync queue count

---

### TC-02 — Offline Incident Edit

**Category:** Offline CRUD  
**Priority:** Critical  

**Preconditions:**
- At least one incident exists locally with `syncStatus: "synced"`
- DevTools Network set to Offline

**Steps:**
1. Click an existing incident card to open the detail view
2. Click "Edit"
3. Change the `severity` and `description` fields
4. Click "Save"

**Expected Results:**
- Updated incident visible immediately in the dashboard
- `updatedAt` timestamp on the record is newer than before the edit
- `version` field incremented by 1
- `syncStatus` changed to `"pending"`
- A new entry in `sync_queue` with `operation: "update"` and `status: "pending"`
- The old `synced` queue entry remains unchanged

**Evidence to Capture:** Screenshot of IndexedDB record before and after edit showing version increment

---

### TC-03 — Service Worker — Offline App Shell

**Category:** Service Worker / Offline Navigation  
**Priority:** Critical  

**Preconditions:**
- Application has been visited at least once while online (Service Worker installed and activated)
- DevTools Network set to Offline

**Steps:**
1. Confirm SW is active: DevTools → Application → Service Workers → status "activated and running"
2. Hard-refresh the page (Ctrl+Shift+R) while still offline
3. Navigate between the Dashboard, Sync Queue, and Conflict Log views

**Expected Results:**
- Application loads fully despite being offline (no "No internet" browser error page)
- All navigation works without network requests
- OFFLINE indicator is shown in the status bar

**Evidence to Capture:** Screenshot of app loaded with network offline; screenshot of DevTools SW panel

---

### TC-04 — Sync on Reconnection (Online Event)

**Category:** Synchronisation  
**Priority:** Critical  

**Preconditions:**
- At least two incidents created or edited while offline (sync_queue has pending items)
- DevTools Network still set to Offline

**Steps:**
1. Note the pending sync count in the status bar
2. Switch DevTools Network back to "No throttling" (online)
3. Observe the UI without clicking anything

**Expected Results:**
- Within 2 seconds of going online, sync starts automatically (status bar shows "Syncing…")
- Queue items transition from `pending` → `syncing` → `synced` in the Sync Queue panel
- Pending count reaches 0
- Status bar shows "Last synced: [timestamp]"
- MongoDB: `db.incidents.find()` returns the newly synced records

**Evidence to Capture:** Before/after screenshots of Sync Queue panel; MongoDB shell output

---

### TC-05 — Manual Sync Now

**Category:** Synchronisation  
**Priority:** High  

**Preconditions:**
- Application is online
- At least one item in `sync_queue` with `status: "pending"`

**Steps:**
1. Click the "Sync Now" button in the status bar or Sync Queue panel

**Expected Results:**
- Sync starts immediately regardless of the online event timing
- Same outcome as TC-04: queue drains, records appear in MongoDB

**Evidence to Capture:** Screenshot showing button click and subsequent synced state

---

### TC-06 — Retry Now for Failed Queue Item

**Category:** Synchronisation / Error Handling  
**Priority:** High  

**Preconditions:**
- A queue item has reached `status: "failed"` (5 attempts exhausted — can be simulated by stopping the server while items are syncing)

**Steps:**
1. Confirm the Sync Queue panel shows the item with status `FAILED` and a "Retry Now" button
2. Start the Express server
3. Click "Retry Now" on the failed item

**Expected Results:**
- Item transitions from `failed` → `syncing` → `synced`
- Attempt counter resets to 0
- Record appears in MongoDB after successful retry
- Item removed from the pending count

**Evidence to Capture:** Screenshot of failed item with Retry Now button; screenshot after successful retry

---

### TC-07 — Two-Browser Conflict Test (Core Scenario)

**Category:** Conflict Detection and Resolution  
**Priority:** Critical  

**This is the primary assignment demonstration test.**

**Preconditions:**
- Express server running and MongoDB accessible
- Same incident record synced to both Browser A (Chrome, Device A) and Browser B (Firefox/Incognito, Device B)
- Confirm both browsers show `syncStatus: "synced"` for the record

**Steps:**
1. Set Browser A to Offline (DevTools)
2. Set Browser B to Offline (DevTools)
3. In Browser A: edit the incident `description` field → Save (records `updatedAt` = T1)
4. In Browser B: edit the incident `severity` field → Save (records `updatedAt` = T2, where T2 > T1)
5. Bring Browser A online → Sync Now → sync succeeds (server now has version N+1, updatedAt = T1)
6. Bring Browser B online → Sync Now → server returns `409 Conflict` (Browser B has version N, server has N+1)

**Expected Results:**
- Browser B displays a conflict notification banner
- Conflict log entry created in `conflict_log` IDB store on Browser B
- LWW comparison: since T2 > T1, Browser B's record (`severity` edit) wins
- Server is updated with Browser B's version (force-push)
- Browser A pulls the updated record on next sync/reconciliation
- Both browsers now show the same final record
- Conflict Log panel on Browser B shows: local snapshot, server snapshot, winner = "local", reason includes timestamp comparison

**Note:** LWW winner is whichever device has the later `updatedAt`. In this test, Browser B wins because T2 > T1. To test the inverse (server wins), repeat with T1 > T2.

**Evidence to Capture:**
- Both browsers in offline state with pending count
- 409 conflict notification on Browser B
- Conflict Log panel showing side-by-side comparison
- Both browsers showing identical final record after pull

---

### TC-08 — Conflict Log Persistence

**Category:** Conflict Logging  
**Priority:** High  

**Preconditions:**
- TC-07 has been completed at least once

**Steps:**
1. Navigate to the Conflict Log panel
2. Refresh the page (Ctrl+R)
3. Navigate back to the Conflict Log panel

**Expected Results:**
- Conflict log entries persist across page refresh
- DevTools → IndexedDB → `conflict_log` store contains entries with full snapshots
- Each entry shows: `conflictId`, `incidentId`, `detectedAt`, `localRecord`, `serverRecord`, `winner`, `resolution`

**Evidence to Capture:** Screenshot of Conflict Log panel after refresh; screenshot of IndexedDB `conflict_log` store

---

### TC-09 — Responsive Layout at 360px

**Category:** Responsive Design  
**Priority:** High  

**Preconditions:**
- Application running (online or offline)
- DevTools → Device Toolbar active

**Steps:**
1. Set viewport to 360×800 (mobile portrait)
2. Navigate through: Dashboard, New Incident form, Incident Detail, Sync Queue, Conflict Log

**Expected Results:**
- No horizontal scroll at 360px
- All interactive elements (buttons, inputs) are fully tappable (min 44×44px touch targets)
- Status bar visible and readable
- Navigation accessible (hamburger or bottom navigation pattern)
- Form fields not cut off or overflowing

**Evidence to Capture:** Screenshot of each major view at 360px

---

### TC-10 — Responsive Layout at 768px and 1440px

**Category:** Responsive Design  
**Priority:** High  

**Preconditions:**
- Application running

**Steps:**
1. Set viewport to 768×1024 (tablet)
2. Capture screenshots of Dashboard and Incident Form
3. Set viewport to 1440×900 (desktop)
4. Capture screenshots of Dashboard and Sync Queue panel

**Expected Results:**
- At 768px: sidebar or expanded navigation visible; incident cards in grid or wider list layout
- At 1440px: full multi-panel layout; sidebar always visible; Sync Queue and Dashboard visible simultaneously
- No layout breakage or overlapping elements at either size

**Evidence to Capture:** Screenshots at both breakpoints

---

### TC-11 — Sync Queue State Transitions (Full Lifecycle)

**Category:** Synchronisation  
**Priority:** High  

**Steps:**
1. Go offline, create an incident → verify `pending`
2. Go online, observe during sync → verify `syncing` (in-flight)
3. Wait for completion → verify `synced`
4. Stop server, create another incident, go online → observe retries → after 5 failures, verify `failed`
5. Start server, click Retry Now → verify transitions back to `synced`

**Expected Results:**
- All five states (`pending`, `syncing`, `synced`, `conflict`, `failed`) are observable in the Sync Queue panel
- State badges use distinct visual styles (color-coded)

**Evidence to Capture:** Screenshots of each state in the Sync Queue panel

---

### TC-12 — Pull / Reconciliation After Conflict

**Category:** Conflict Resolution / Convergence  
**Priority:** High  

**Preconditions:**
- TC-07 completed; Browser A has stale data (its version of the record was overwritten by Browser B's win)

**Steps:**
1. On Browser A, click "Sync Now" or wait for the next automatic reconciliation pull
2. Observe the incident record on Browser A

**Expected Results:**
- Browser A fetches the server's current version of the incident
- Browser A's local `incidents` store is updated with the winning record
- `syncStatus` on Browser A for that record shows `"synced"`
- Both browsers display identical field values for the incident

**Evidence to Capture:** Side-by-side screenshots of both browsers showing the same record

---

## Evidence Checklist

| Test Case | Screenshot | IDB Screenshot | Notes |
|---|---|---|---|
| TC-01 | ✓ Required | ✓ Required | |
| TC-02 | ✓ Required | ✓ Required | |
| TC-03 | ✓ Required | — | SW panel screenshot |
| TC-04 | ✓ Required | — | MongoDB shell output |
| TC-05 | ✓ Required | — | |
| TC-06 | ✓ Required | — | Before + after |
| TC-07 | ✓ Required | ✓ Required | Core demo — most critical |
| TC-08 | ✓ Required | ✓ Required | |
| TC-09 | ✓ Required | — | 360px screenshots |
| TC-10 | ✓ Required | — | 768px + 1440px screenshots |
| TC-11 | ✓ Required | — | All 5 states |
| TC-12 | ✓ Required | — | Side-by-side browsers |

---

## Phase 2D Test Cases

### TC-13 — API Health Check

**Category:** Server  
**Priority:** Critical

**Steps:**
1. Start Express server: `cd server && npm run dev`
2. Open browser or terminal: `GET http://localhost:5000/api/health`

**Expected:** HTTP 200, body `{ "ok": true, "service": "blackbox-api" }`

**Evidence:** Browser/Postman screenshot of response

---

### TC-14 — Online Create Sync

**Category:** Synchronisation  
**Priority:** Critical

**Steps:**
1. Server running, MongoDB running
2. Open `http://localhost:5173` (Vite dev) or `http://localhost:4173` (preview)
3. Create a new incident via the form
4. Click **Sync Now** or wait for the automatic online-event trigger

**Expected:**
- `sync_queue` item transitions: `pending` → `syncing` → `synced`
- `incident.syncStatus` = `synced`
- `incident.version` updated to server-returned value (1)
- MongoDB: `db.incidents.find({ incidentCode: "..." })` returns the record

**Evidence:** Sync Queue panel screenshot + MongoDB Compass

---

### TC-15 — Refresh Persistence After Sync

**Category:** Persistence  
**Priority:** Critical

**Steps:**
1. Complete TC-14
2. Refresh the browser (F5)

**Expected:** Incident still visible in dashboard, loaded from IndexedDB, `syncStatus: "synced"`

---

### TC-16 — Offline Create

**Category:** Offline  
**Priority:** Critical

**Steps:**
1. DevTools → Network → Offline
2. Create a new incident

**Expected:**
- Incident saved locally immediately (no error)
- `sync_queue` entry: `status: "pending"`, `operation: "create"`
- Status bar shows OFFLINE + pending count

---

### TC-17 — Reconnect Sync

**Category:** Synchronisation  
**Priority:** Critical

**Steps:**
1. Complete TC-16 (incident created offline)
2. DevTools → Network → No throttling (go online)

**Expected:**
- `window` online event fires → sync engine starts automatically
- Queue item transitions to `synced`
- Incident appears in MongoDB
- Status bar shows last synced timestamp

---

### TC-18 — Server Unavailable

**Category:** Resilience  
**Priority:** High

**Steps:**
1. Stop Express server (`Ctrl+C`)
2. Create an incident in the client

**Expected:** Incident saves locally; `syncStatus: "pending"` or `"failed"` after retry attempts

3. Restart Express server
4. Click **Sync Now**

**Expected:** Queue item transitions to `synced`; MongoDB contains the record

---

### TC-19 — Update Sync (Version Increment)

**Category:** Synchronisation  
**Priority:** High

**Steps:**
1. Create and sync an incident (version = 1 on server)
2. Edit the incident (description or severity)
3. Sync Now

**Expected:**
- Server returns `version: 2`
- Local `incident.version` updated to 2
- Queue item: `synced`

---

### TC-20 — Queue Ordering (Create then Update offline)

**Category:** Queue Ordering  
**Priority:** High

**Steps:**
1. Go offline
2. Create a new incident → IDB creates `create` queue entry
3. Immediately edit the same incident → IDB creates `update` queue entry
4. Go online → Sync Now

**Expected:**
- `create` entry processed first (POST succeeds)
- `update` entry processed second (PUT with `version: 1` succeeds)
- Final MongoDB record reflects the edited values
- Both queue entries: `synced`

**Evidence:** Sync Queue panel showing two entries with correct order + timestamps

---

### TC-21 — Stale Version → 409

**Category:** Conflict Detection  
**Priority:** Critical

**Steps:**
1. Create and sync incident (server version = 1)
2. In MongoDB Compass, manually increment `version` to 3 (simulates another device updating)
3. Edit the incident locally (client still has version = 1 in its queue payload)
4. Sync Now

**Expected:**
- Server returns HTTP 409 `VERSION_CONFLICT`
- Queue item: `status: "conflict"`, `errorMessage` contains `VERSION_CONFLICT: client v1 vs server v3`
- `serverSnapshot` field on queue item contains server record
- `incident.syncStatus: "conflict"`
- No automatic winner selected

**Evidence:** Sync Queue panel showing CONFLICT badge + DevTools IndexedDB showing `serverSnapshot`

---

### TC-22 — Conflict Queue State Inspection

**Category:** Conflict Detection  
**Priority:** High

**Preconditions:** TC-21 completed

**Steps:**
1. Open DevTools → Application → IndexedDB → `blackbox_db` → `sync_queue`
2. Locate the conflict item

**Expected:** Item has:
- `status: "conflict"`
- `serverSnapshot: { version: 3, ... }` (the server's record at conflict time)
- `errorMessage: "VERSION_CONFLICT: ..."`

3. Navigate to Sync Queue panel in UI
4. Confirm CONFLICT badge is visible on the item

---

### TC-23 — Service Worker Regression (Phase 2C)

**Category:** Offline Shell  
**Priority:** High

**Steps:**
1. `npm run build && npm run preview`
2. Open `http://localhost:4173`
3. Confirm SW registers (DevTools → Application → Service Workers)
4. DevTools → Network → Offline
5. Refresh page

**Expected:** BLACKBOX shell loads from SW cache; IndexedDB data still visible

---

## Evidence Checklist (Phase 2D)

| Test | Screenshot | IDB | MongoDB | Notes |
|---|---|---|---|---|
| TC-13 API health | ✓ | — | — | |
| TC-14 Online create | ✓ | ✓ | ✓ | |
| TC-15 Refresh | ✓ | ✓ | — | |
| TC-16 Offline create | ✓ | ✓ | — | |
| TC-17 Reconnect sync | ✓ | ✓ | ✓ | |
| TC-18 Server unavailable | ✓ | ✓ | ✓ | |
| TC-19 Update + version | ✓ | ✓ | ✓ | |
| TC-20 Queue ordering | ✓ | ✓ | ✓ | |
| TC-21 Stale version 409 | ✓ | ✓ | — | DevTools IDB for serverSnapshot |
| TC-22 Conflict state | ✓ | ✓ | — | |
| TC-23 SW regression | ✓ | ✓ | — | |

---

## Phase 2E Test Cases

### TC-24 — Two-Device Update/Update Conflict (Core Demo)

**Category:** Conflict Resolution  
**Priority:** Critical — primary assignment demonstration

**Setup:**
- Chrome normal window = Device A (`http://localhost:5173` or `localhost:4173`)
- Chrome Incognito = Device B (same URL)
- Express server running, MongoDB running
- Each browser has a distinct `deviceId` (check DevTools → Application → Local Storage → `blackbox_device_id`)

**Steps:**
1. In Device A: create incident `BBX-DEMO-001`, save and sync → server version = 1
2. Confirm Device B can see it (refresh or Sync Now) → both show version 1, `syncStatus: synced`
3. Set Device A to Offline (DevTools → Network → Offline)
4. Set Device B to Offline
5. Device A: edit `description` field → Save  
   Note the `updatedAt` timestamp (T1)
6. Device B: edit `severity` field → Save  
   Note the `updatedAt` timestamp (T2)
7. Bring Device A online → Sync Now  
   Server accepts → server version = 2, `updatedAt = T1`
8. Bring Device B online → Sync Now  
   Server returns **HTTP 409 VERSION_CONFLICT**
9. Observe Device B:
   - Conflict notification banner appears: `CONFLICT DETECTED + RESOLVED`
   - Winner shown (LOCAL if T2 > T1, SERVER if T1 > T2)
   - Sync queue item transitions: `syncing` → `synced`
10. Device A: Sync Now (pull reconciliation)  
    Device A receives the authoritative record

**Expected Results:**
- Both browsers show the same incident fields, same `version`, same `updatedAt`
- Conflict Log panel on Device B shows the audit entry with local/server snapshots
- `conflict_log` IDB store has one entry with `winner`, `reason`, `resolvedSnapshot`
- MongoDB: `db.incidents.find({incidentCode:'BBX-DEMO-001'})` shows final authoritative record

**Evidence to capture:**
1. Both browsers in offline state with pending count
2. Device A synced successfully (queue = synced, server v2)
3. Device B showing 409 conflict notification with winner/loser panel
4. Conflict Log panel: side-by-side snapshot comparison
5. DevTools IDB `conflict_log` store showing the entry
6. Both browsers showing identical final record (side-by-side screenshot)

---

### TC-25 — Delete-vs-Edit Conflict

**Category:** Conflict Resolution — Edge Case  
**Priority:** High

**Steps:**
1. Create and sync incident `BBX-EDGE-001`
2. Device A goes offline → closes the incident (status → `closed`) → saves
3. Device B goes offline → edits `description` → saves
4. Device A syncs first → server accepts close → `status: closed`, version incremented
5. Device B syncs → receives 409
6. LWW resolves based on `updatedAt`:
   - If Device B's edit timestamp is later → Device B wins → incident description updated, status may revert to pre-close value
   - If Device A's close timestamp is later → Device A wins → incident stays `closed`

**Expected Results:**
- Conflict notification shown on Device B
- Audit log entry created
- No special rule applied — pure LWW_UPDATED_AT decides
- Winning state reflected in both devices after pull

**Documentation note:** The delete-vs-edit outcome is timestamp-dependent, not operation-type-dependent. This is documented as expected behaviour.

---

### TC-26 — Clock Skew Scenario

**Category:** Known Limitation  
**Priority:** Medium (documentation + awareness test)

**Steps:**
1. Advance Device A's system clock by 5 minutes (Windows: Date/Time settings)
2. Both devices go offline
3. Device A edits an incident first (actual time: T), gets `updatedAt = T+5min` (due to fast clock)
4. Device B edits the same incident one minute later (actual time T+1min), gets `updatedAt = T+1min`
5. Sync in any order

**Expected Results:**
- Device A wins LWW despite editing first in actual time
- Conflict log entry shows Device A's `updatedAt` as later
- This demonstrates the documented clock skew limitation
- No data loss — the loser's state is preserved in `serverSnapshot` / `localSnapshot`

**Documentation requirement:** Screenshot of conflict log showing the skewed timestamps. Note this as a known limitation in the submission.

---

### TC-27 — Conflict Audit Log Persistence

**Category:** Audit Log  
**Priority:** High

**Preconditions:** TC-24 completed at least once

**Steps:**
1. Navigate to Conflict Log panel
2. Confirm at least one entry is visible with: Detected time, Resolved time, Rule, Winner, Reason
3. Expand entry → confirm side-by-side field diff showing differing fields
4. Refresh browser (F5)
5. Navigate back to Conflict Log

**Expected Results:**
- Entries persist after page refresh (stored in IDB `conflict_log`, not just Zustand)
- Side-by-side diff still expandable after refresh
- DevTools → Application → IndexedDB → `blackbox_db` → `conflict_log` shows full entry with `localSnapshot`, `serverSnapshot`, `resolvedSnapshot`

**Evidence:** Screenshot of Conflict Log panel + DevTools IDB view

---

### TC-28 — Convergence Verification

**Category:** Two-Device Convergence  
**Priority:** Critical

**Preconditions:** TC-24 completed

**Steps:**
1. On Device B: note the final incident field values shown in the dashboard
2. On Device A: click Sync Now (or wait for pull)
3. Note the final incident field values on Device A
4. Open the incident detail on both devices

**Expected Results:**
- `incidentCode`, `description`, `severity`, `status`, `updatedAt`, `version` are identical on both devices
- `syncStatus` = `synced` on both devices
- MongoDB record matches both clients

**Evidence:** Side-by-side screenshot of both browsers showing the same incident detail view

---

### TC-29 — Conflict Resolution Failure / Retry

**Category:** Error Handling  
**Priority:** Medium

**Steps:**
1. Stop the Express server
2. Create a situation where a 409 would occur (two devices edit same record offline)
3. Bring Device B online (Device A already synced while server was up)
4. Sync Now → 409 detected → attempt to POST /resolve → server is down → fails

**Expected Results:**
- Queue item marked `failed` with error message: `Conflict resolved locally (local won) but server upload failed: ...`
- Conflict notification still shown (audit log was written before the upload attempt)
- `incident.syncStatus` = `failed`

5. Start Express server
6. Click Retry Now on the failed queue item

**Expected Results:**
- The retry re-attempts the `/resolve` POST
- Queue transitions to `synced`
- Server receives the resolved record

**Note:** The current `retryQueueItem` resets the queue item to `pending` which re-enters the normal flush loop. On retry, the `_sendItem` function will call `PUT` again, get another 409, and re-run `_handleConflict`. The second resolution may produce the same or different winner depending on timestamps. This is documented expected behaviour.

---

### TC-30 — Conflict Resolver Unit Tests

**Category:** Unit Tests  
**Priority:** High

**Steps:**
```bash
cd client
node src/sync/conflictResolver.test.mjs
```

**Expected Results:**
```
Running conflictResolver unit tests...
  [PASS] TC-R1: local newer → local wins
  [PASS] TC-R1: resolvedRecord is local
  [PASS] TC-R1: tieBreak is false
  [PASS] TC-R2: server newer → server wins
  [PASS] TC-R2: resolvedRecord is server
  [PASS] TC-R3: equal ts, local deviceId > server → local wins
  [PASS] TC-R3: tieBreak is true
  [PASS] TC-R4: equal ts, server deviceId > local → server wins
  [PASS] TC-R4: tieBreak is true
  [PASS] TC-R5: missing local ts → server wins
  [PASS] TC-R6: both missing ts → deviceId tie-break, local mmm > aaa
  [PASS] TC-R6: tieBreak is true
  [PASS] TC-R7: deterministic — same result on repeated call
  [PASS] TC-R8: input not mutated
ConflictResolver tests: 14 passed, 0 failed
```

Exit code: 0

---

## Evidence Checklist (Phase 2E)

| Test | Screenshot | IDB | MongoDB | Notes |
|---|---|---|---|---|
| TC-24 Two-device conflict | ✓ Required | ✓ Required | ✓ Required | Core demo — most critical |
| TC-25 Delete-vs-edit | ✓ Required | — | — | Document outcome |
| TC-26 Clock skew | ✓ Required | — | — | Screenshot conflict log timestamps |
| TC-27 Audit log persistence | ✓ Required | ✓ Required | — | After page refresh |
| TC-28 Convergence | ✓ Required | — | ✓ Required | Side-by-side both browsers |
| TC-29 Resolution failure | ✓ Required | — | — | Failed + retry states |
| TC-30 Unit tests | Terminal output | — | — | Copy terminal result |

## Screenshot Evidence Checklist (Full Submission)

| # | Screenshot | When to capture |
|---|---|---|
| 1 | BLACKBOX dashboard | After Phase 2A |
| 2 | IndexedDB `incidents` store | After creating an incident |
| 3 | Sync queue with pending items | Before syncing |
| 4 | Queue after sync — all synced | After successful sync |
| 5 | Device A offline with pending count | During TC-24 step 3 |
| 6 | Device B offline with pending count | During TC-24 step 4 |
| 7 | HTTP 409 conflict notification (Device B) | During TC-24 step 8 |
| 8 | Conflict resolution banner — winner shown | During TC-24 step 9 |
| 9 | Conflict Log panel with full entry | After TC-24 |
| 10 | Side-by-side browser convergence | TC-28 |
| 11 | 360px responsive layout | DevTools device emulator |
| 12 | 768px responsive layout | DevTools device emulator |
| 13 | 1440px responsive layout | DevTools device emulator |
| 14 | Service Worker active (DevTools) | After npm run preview |
| 15 | Offline shell reload | SW installed, network offline, refresh |

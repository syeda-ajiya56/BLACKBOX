// BLACKBOX — Sync Engine
// ============================================================
// Processes the IndexedDB sync_queue and pushes mutations to
// the Express REST API.
//
// TRIGGER ENTRY POINTS (three — none is the only one):
//   1. window 'online' event          → flush()  [primary]
//   2. Manual "Sync Now" button        → flush()  [primary]
//   3. SW 'TRIGGER_SYNC' message       → flush()  [supplementary]
//
// QUEUE ORDERING:
//   Items processed oldest-first. For the same incidentId, an
//   earlier item that fails/conflicts blocks all later items for
//   that incident in the current flush cycle.
//
// CONFLICT RESOLUTION (Phase 2E — LWW):
//   409 → capture both snapshots
//      → resolveConflict() (pure LWW function)
//      → appendConflictEntry() (immutable audit log)
//      → if local wins: POST /api/incidents/:id/resolve
//      → if server wins: overwrite local record with server snapshot
//      → GET /api/incidents/:id to pull authoritative final state
//      → update IndexedDB + Zustand
//      → mark queue item 'synced'
//      → surface conflict notification in UI
//
// ANTI-LOOP:
//   The /resolve endpoint uses resolutionToken: true so the server
//   bypasses version equality checking. This never loops back to 409.
// ============================================================

import {
  getAllQueueItems,
  getPendingItems,
  updateQueueItem,
} from '../db/syncQueue'
import {
  getAllIncidents,
  getIncident,
  putIncident,
  updateIncidentSyncStatus,
} from '../db/incidents'
import {
  createIncidentOnServer,
  updateIncidentOnServer,
  deleteIncidentOnServer,
  getIncidentsFromServer,
  getIncidentFromServer,
  resolveIncidentOnServer,
} from '../api/client'
import { appendConflictEntry, getAllConflictEntries } from '../db/conflictLog'
import { resolveConflict } from './conflictResolver'
import { getDeviceId } from './deviceId'
import useAppStore from '../store/appStore'

// ── Concurrency lock ─────────────────────────────────────────
let _flushing = false
const MAX_ATTEMPTS = 5

// ─────────────────────────────────────────────────────────────
// flush()
// ─────────────────────────────────────────────────────────────
export async function flush() {
  if (_flushing) {
    console.log('[SYNC] Already running — skipping concurrent flush.')
    return
  }
  if (!navigator.onLine) {
    console.log('[SYNC] Offline — flush deferred.')
    return
  }

  _flushing = true
  const store = useAppStore.getState()
  store.setSyncing(true)
  store.setSyncError(null)
  console.log('[SYNC] Starting sync flush.')

  try {
    await _processQueue()
    await _pullLatestIncidents()
    const now = new Date().toISOString()
    useAppStore.getState().setLastSyncedAt(now)
    console.log('[SYNC] Sync completed at', now)
  } catch (err) {
    console.error('[SYNC] Unexpected error during flush:', err)
    useAppStore.getState().setSyncError(err.message || 'Sync failed unexpectedly')
  } finally {
    _flushing = false
    useAppStore.getState().setSyncing(false)
    await _refreshStoreFromIDB()
  }
}

// ─────────────────────────────────────────────────────────────
// _processQueue()
// ─────────────────────────────────────────────────────────────
async function _processQueue() {
  const pendingItems = await getPendingItems()
  if (pendingItems.length === 0) {
    console.log('[SYNC] Queue empty.')
    return
  }
  console.log(`[SYNC] Processing ${pendingItems.length} pending item(s).`)

  const blockedIncidents = new Set()

  for (const item of pendingItems) {
    if (blockedIncidents.has(item.incidentId)) {
      console.log(`[SYNC] Skipping ${item.queueId} — blocked by earlier item for ${item.incidentId}.`)
      continue
    }

    console.log(`[SYNC] Processing ${item.queueId} (${item.operation} ${item.incidentId})`)

    await updateQueueItem(item.queueId, { status: 'syncing' })
    await updateIncidentSyncStatus(item.incidentId, 'syncing')
    _updateQueueInStore(item.queueId, { status: 'syncing' })

    const result = await _sendItem(item)

    if (result === 'success') {
      await updateQueueItem(item.queueId, { status: 'synced' })
      _updateQueueInStore(item.queueId, { status: 'synced' })
      console.log(`[SYNC] ✓ ${item.operation} ${item.incidentId} — synced.`)
    } else if (result === 'resolved') {
      // Conflict was detected AND resolved in _sendItem — queue item already updated there
      console.log(`[SYNC] ⚡→✓ ${item.incidentId} — conflict resolved.`)
    } else if (result === 'conflict-failed') {
      // Conflict detected but resolution upload failed — marked failed in _sendItem
      blockedIncidents.add(item.incidentId)
      console.log(`[SYNC] ⚡✗ ${item.incidentId} — conflict resolution failed.`)
    } else {
      // Network/server error
      const newAttempts = (item.attempts || 0) + 1
      if (newAttempts >= MAX_ATTEMPTS) {
        await updateQueueItem(item.queueId, { status: 'failed', attempts: newAttempts })
        await updateIncidentSyncStatus(item.incidentId, 'failed')
        _updateQueueInStore(item.queueId, { status: 'failed', attempts: newAttempts })
        blockedIncidents.add(item.incidentId)
        console.log(`[SYNC] ✗ ${item.incidentId} failed after ${newAttempts} attempts.`)
      } else {
        await updateQueueItem(item.queueId, { status: 'pending', attempts: newAttempts })
        await updateIncidentSyncStatus(item.incidentId, 'pending')
        _updateQueueInStore(item.queueId, { status: 'pending', attempts: newAttempts })
        blockedIncidents.add(item.incidentId)
        console.log(`[SYNC] ↺ ${item.incidentId} — attempt ${newAttempts}/${MAX_ATTEMPTS}.`)
      }
    }
  }

  const allItems = await getAllQueueItems()
  useAppStore.getState().setPendingCount(allItems.filter(q => q.status === 'pending').length)
}

// ─────────────────────────────────────────────────────────────
// _sendItem(queueItem)
// Returns: 'success' | 'resolved' | 'conflict-failed' | 'error'
// ─────────────────────────────────────────────────────────────
async function _sendItem(item) {
  try {
    let result

    // ── CREATE ────────────────────────────────────────────
    if (item.operation === 'create') {
      result = await createIncidentOnServer(item.payload)

      if (result.ok) {
        const srv = result.data?.incident
        if (srv) {
          await putIncident({ ...srv, syncStatus: 'synced' })
          _updateIncidentInStore(srv.id, { ...srv, syncStatus: 'synced' })
        }
        return 'success'
      }
      // CREATE conflicts are unusual (same id already on server) — treat as success
      if (result.conflict) {
        const srv = result.serverIncident
        if (srv) {
          await putIncident({ ...srv, syncStatus: 'synced' })
          _updateIncidentInStore(srv.id, { ...srv, syncStatus: 'synced' })
        }
        return 'success'
      }
      if (result.offline || result.networkError) return 'error'
      await updateQueueItem(item.queueId, { errorMessage: result.error || 'HTTP error on create' })
      return 'error'
    }

    // ── UPDATE ────────────────────────────────────────────
    if (item.operation === 'update') {
      const localIncident = await getIncident(item.incidentId)
      if (!localIncident) {
        console.warn(`[SYNC] UPDATE skipped — incident ${item.incidentId} not found locally.`)
        return 'success'
      }

      result = await updateIncidentOnServer(item.incidentId, item.payload)

      if (result.ok) {
        const srv = result.data?.incident
        if (srv) {
          await putIncident({ ...srv, syncStatus: 'synced' })
          _updateIncidentInStore(srv.id, { ...srv, syncStatus: 'synced' })
        }
        return 'success'
      }

      if (result.conflict) {
        return await _handleConflict(item, localIncident, result.serverIncident)
      }
      if (result.offline || result.networkError) return 'error'
      await updateQueueItem(item.queueId, { errorMessage: result.error || 'HTTP error on update' })
      return 'error'
    }

    // ── DELETE (soft close) ───────────────────────────────
    if (item.operation === 'delete') {
      result = await deleteIncidentOnServer(item.incidentId, item.payload?.version)

      if (result.ok) {
        const srv = result.data?.incident
        if (srv) {
          await putIncident({ ...srv, syncStatus: 'synced' })
          _updateIncidentInStore(srv.id, { ...srv, syncStatus: 'synced' })
        }
        return 'success'
      }
      if (result.conflict) {
        const localIncident = await getIncident(item.incidentId)
        return await _handleConflict(item, localIncident || item.payload, result.serverIncident)
      }
      if (result.offline || result.networkError) return 'error'
      await updateQueueItem(item.queueId, { errorMessage: result.error || 'HTTP error on delete' })
      return 'error'
    }

    console.warn(`[SYNC] Unknown operation: ${item.operation}`)
    return 'error'

  } catch (err) {
    console.error(`[SYNC] _sendItem threw:`, err)
    await updateQueueItem(item.queueId, { errorMessage: err.message })
    return 'error'
  }
}

// ─────────────────────────────────────────────────────────────
// _handleConflict(item, localIncident, serverIncident)
//
// Full LWW conflict resolution workflow:
//   1. resolveConflict() → pure decision
//   2. appendConflictEntry() → immutable audit log
//   3. Apply winner locally to IndexedDB
//   4. If local wins: POST /resolve → server accepts, returns authoritative record
//   5. Pull final authoritative record from server
//   6. Update IDB + Zustand
//   7. Mark queue item synced
//   8. Notify UI
//
// Returns: 'resolved' | 'conflict-failed'
// ─────────────────────────────────────────────────────────────
async function _handleConflict(item, localIncident, serverIncident) {
  const deviceId = getDeviceId()
  console.log(`[SYNC] ⚡ Conflict detected: ${item.incidentId}`)
  console.log(`[SYNC]   Local  updatedAt: ${localIncident?.updatedAt}`)
  console.log(`[SYNC]   Server updatedAt: ${serverIncident?.updatedAt}`)

  // ── Step 1: Pure LWW decision ─────────────────────────
  let decision
  try {
    decision = resolveConflict(localIncident, serverIncident)
  } catch (err) {
    console.error('[SYNC] resolveConflict threw:', err)
    await updateQueueItem(item.queueId, {
      status:       'failed',
      errorMessage: `Resolution error: ${err.message}`,
    })
    await updateIncidentSyncStatus(item.incidentId, 'failed')
    return 'conflict-failed'
  }

  console.log(`[SYNC]   Winner: ${decision.winner} — ${decision.reason}`)

  // ── Step 2: Append immutable audit entry ──────────────
  let logEntry
  try {
    logEntry = await appendConflictEntry({
      incidentId:       item.incidentId,
      localSnapshot:    localIncident,
      serverSnapshot:   serverIncident,
      winner:           decision.winner,
      loser:            decision.loser,
      reason:           decision.reason,
      rule:             decision.rule,
      resolvedSnapshot: decision.resolvedRecord,
      deviceId,
    })
    console.log('[SYNC]   Audit entry written:', logEntry.conflictId)
  } catch (err) {
    // Audit write failure is non-fatal — resolution continues
    console.error('[SYNC]   Audit write failed (non-fatal):', err)
  }

  // ── Step 3 + 4 + 5: Apply winner and sync to server ──
  let authoritativeRecord

  if (decision.winner === 'local') {
    // Local won — upload the winning record to /resolve
    const uploadResult = await resolveIncidentOnServer(
      item.incidentId,
      decision.resolvedRecord,
      'local'
    )

    if (!uploadResult.ok) {
      console.error('[SYNC]   /resolve upload failed:', uploadResult.error)
      await updateQueueItem(item.queueId, {
        status:       'failed',
        errorMessage: `Conflict resolved locally (local won) but server upload failed: ${uploadResult.error}`,
      })
      await updateIncidentSyncStatus(item.incidentId, 'failed')
      // Still surface the notification — user knows outcome
      _notifyConflict(logEntry, decision)
      return 'conflict-failed'
    }

    authoritativeRecord = uploadResult.data?.incident
    console.log(`[SYNC]   /resolve accepted → server v${authoritativeRecord?.version}`)

  } else {
    // Server won — we need to fetch the current authoritative server record
    // (serverIncident from the 409 is already it, but do a GET to confirm final state)
    const pullResult = await getIncidentFromServer(item.incidentId)
    authoritativeRecord = pullResult.ok
      ? pullResult.data?.incident
      : serverIncident   // fall back to 409 snapshot if GET fails
  }

  // ── Step 6: Write authoritative record to IDB ─────────
  if (authoritativeRecord) {
    await putIncident({ ...authoritativeRecord, syncStatus: 'synced' })
    _updateIncidentInStore(authoritativeRecord.id, { ...authoritativeRecord, syncStatus: 'synced' })
  }

  // ── Step 7: Mark queue item synced ────────────────────
  await updateQueueItem(item.queueId, {
    status:       'synced',
    errorMessage: null,
    serverSnapshot: serverIncident,   // preserved for audit UI
  })
  _updateQueueInStore(item.queueId, { status: 'synced' })

  // ── Step 8: Surface notification in UI ────────────────
  _notifyConflict(logEntry, decision)

  return 'resolved'
}

// ─────────────────────────────────────────────────────────────
// _notifyConflict(logEntry, decision)
// Pushes a conflict notification to the Zustand activeConflicts array.
// The UI (ConflictNotification.jsx) renders a non-dismissible banner.
// ─────────────────────────────────────────────────────────────
function _notifyConflict(logEntry, decision) {
  if (!logEntry) return
  useAppStore.getState().addConflict({
    conflictId:     logEntry.conflictId,
    incidentId:     logEntry.incidentId,
    winner:         logEntry.winner,
    loser:          logEntry.loser,
    resolution:     logEntry.reason,
    rule:           logEntry.rule,
    localRecord:    logEntry.localSnapshot,
    serverRecord:   logEntry.serverSnapshot,
    resolvedRecord: logEntry.resolvedSnapshot,
    detectedAt:     logEntry.detectedAt,
    resolvedAt:     logEntry.resolvedAt,
  })
}

// ─────────────────────────────────────────────────────────────
// _pullLatestIncidents()
// ─────────────────────────────────────────────────────────────
async function _pullLatestIncidents() {
  const { lastSyncedAt } = useAppStore.getState()
  const result = await getIncidentsFromServer(lastSyncedAt)
  if (!result.ok) {
    console.warn('[SYNC] Pull failed:', result.error)
    return
  }

  const serverIncidents = result.data?.incidents ?? []
  if (serverIncidents.length === 0) return

  const queue           = await getAllQueueItems()
  const locallyModified = new Set(
    queue
      .filter(q => ['pending','syncing','conflict'].includes(q.status))
      .map(q => q.incidentId)
  )

  let upserted = 0
  for (const srv of serverIncidents) {
    if (locallyModified.has(srv.id)) continue
    await putIncident({ ...srv, syncStatus: 'synced' })
    _updateIncidentInStore(srv.id, { ...srv, syncStatus: 'synced' })
    upserted++
  }

  if (upserted > 0) console.log(`[SYNC] Pull reconciled ${upserted} record(s).`)
}

// ─────────────────────────────────────────────────────────────
// _refreshStoreFromIDB()
// ─────────────────────────────────────────────────────────────
async function _refreshStoreFromIDB() {
  try {
    const [incidents, queue, conflicts] = await Promise.all([
      getAllIncidents(),
      getAllQueueItems(),
      getAllConflictEntries(),
    ])
    useAppStore.setState({
      incidents,
      syncQueue:    queue,
      conflictLog:  conflicts,
      pendingCount: queue.filter(q => q.status === 'pending').length,
    })
  } catch (err) {
    console.warn('[SYNC] _refreshStoreFromIDB failed:', err)
  }
}

// ─────────────────────────────────────────────────────────────
// Zustand patch helpers
// ─────────────────────────────────────────────────────────────
function _updateIncidentInStore(id, updates) {
  useAppStore.setState((s) => ({
    incidents: s.incidents.map(i => i.id === id ? { ...i, ...updates } : i),
  }))
}

function _updateQueueInStore(queueId, updates) {
  useAppStore.setState((s) => ({
    syncQueue: s.syncQueue.map(q => q.queueId === queueId ? { ...q, ...updates } : q),
  }))
}

// ─────────────────────────────────────────────────────────────
// registerOnlineListener()
// ─────────────────────────────────────────────────────────────
export function registerOnlineListener() {
  window.addEventListener('online', () => {
    console.log('[SYNC] Network restored — triggering sync.')
    flush()
  })
  console.log('[SYNC] Online listener registered.')
}

// ─────────────────────────────────────────────────────────────
// registerSWMessageListener()
// ─────────────────────────────────────────────────────────────
export function registerSWMessageListener() {
  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'TRIGGER_SYNC') {
      console.log('[SYNC] SW background sync message — triggering flush.')
      flush()
    }
  })
  console.log('[SYNC] SW message listener registered.')
}

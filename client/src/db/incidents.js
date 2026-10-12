// BLACKBOX — incidents store CRUD
//
// Every mutation (create / update / delete) is atomic:
// the incident write and the sync_queue entry are committed in a single
// multi-store readwrite transaction so they are never out of sync.
//
// Fields managed automatically by this module:
//   createdAt  — set once at creation (ISO8601)
//   updatedAt  — updated on every write (ISO8601)
//   version    — integer, incremented on every local edit
//   syncStatus — set to 'pending' on every local mutation
//   deviceId   — read from localStorage (set by deviceId.js on first app load)

import { openDB } from './indexedDB'
import { v4 as uuidv4 } from 'uuid'

// ─────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────

function getDeviceId() {
  return localStorage.getItem('blackbox_device_id') || 'device-unknown'
}

function generateIncidentCode() {
  const year = new Date().getFullYear()
  const num  = String(Math.floor(Math.random() * 90000) + 10000)
  return `INC-${year}-${num}`
}

/** Wrap an IDBRequest in a Promise (used where we need the result value). */
function reqValue(idbRequest) {
  return new Promise((resolve, reject) => {
    idbRequest.onsuccess = (e) => resolve(e.target.result)
    idbRequest.onerror   = (e) => reject(e.target.error)
  })
}

/** Build a sync_queue entry object (does not write it). */
function buildQueueEntry(incidentId, operation, payload) {
  return {
    queueId:      uuidv4(),
    incidentId,
    operation,
    payload:      { ...payload },
    timestamp:    new Date().toISOString(),
    attempts:     0,
    status:       'pending',
    errorMessage: null,
  }
}

// ─────────────────────────────────────────────────────────────
// getAllIncidents()
// Returns all incidents sorted by updatedAt descending.
// ─────────────────────────────────────────────────────────────
export async function getAllIncidents() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx      = db.transaction('incidents', 'readonly')
    const store   = tx.objectStore('incidents')
    const request = store.getAll()

    request.onsuccess = (e) => {
      const incidents = e.target.result
      incidents.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      resolve(incidents)
    }
    request.onerror = (e) => reject(e.target.error)
  })
}

// ─────────────────────────────────────────────────────────────
// getIncident(id)
// Returns a single incident by its client UUID, or null if not found.
// ─────────────────────────────────────────────────────────────
export async function getIncident(id) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx      = db.transaction('incidents', 'readonly')
    const store   = tx.objectStore('incidents')
    const request = store.get(id)

    request.onsuccess = (e) => resolve(e.target.result ?? null)
    request.onerror   = (e) => reject(e.target.error)
  })
}

// ─────────────────────────────────────────────────────────────
// createIncident(fields)
//
// fields: all user-supplied incident fields (no id, no timestamps).
// Returns the full saved incident object including auto-assigned fields.
//
// Atomic: incident + sync_queue written in one transaction.
// ─────────────────────────────────────────────────────────────
export async function createIncident(fields) {
  const now      = new Date().toISOString()
  const deviceId = getDeviceId()

  const incident = {
    id:           uuidv4(),
    incidentCode: fields.incidentCode || generateIncidentCode(),
    rideId:       fields.rideId,
    driverName:   fields.driverName,
    vehicleId:    fields.vehicleId,
    incidentType: fields.incidentType,
    severity:     fields.severity,
    description:  fields.description,
    location:     fields.location,
    status:       fields.status || 'open',
    createdAt:    now,
    updatedAt:    now,
    version:      1,
    deviceId,
    syncStatus:   'pending',
  }

  const queueEntry = buildQueueEntry(incident.id, 'create', incident)

  const db = await openDB()

  await new Promise((resolve, reject) => {
    const tx         = db.transaction(['incidents', 'sync_queue'], 'readwrite')
    const incStore   = tx.objectStore('incidents')
    const queueStore = tx.objectStore('sync_queue')

    incStore.add(incident)
    queueStore.add(queueEntry)

    tx.oncomplete = () => {
      console.log('[IDB] Incident created:', incident.id, incident.incidentCode)
      resolve()
    }
    tx.onerror = (e) => {
      console.error('[IDB] createIncident failed:', e.target.error)
      reject(e.target.error)
    }
    tx.onabort = (e) => reject(new Error('createIncident transaction aborted'))
  })

  return { incident, queueEntry }
}

// ─────────────────────────────────────────────────────────────
// updateIncident(id, changes)
//
// changes: partial incident fields to merge.
// Returns the full updated incident.
//
// Increments version, updates updatedAt, sets syncStatus = 'pending'.
// Atomic: incident + sync_queue written in one transaction.
// ─────────────────────────────────────────────────────────────
export async function updateIncident(id, changes) {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const tx         = db.transaction(['incidents', 'sync_queue'], 'readwrite')
    const incStore   = tx.objectStore('incidents')
    const queueStore = tx.objectStore('sync_queue')

    const getReq = incStore.get(id)

    getReq.onsuccess = (e) => {
      const existing = e.target.result
      if (!existing) {
        reject(new Error(`Incident not found: ${id}`))
        tx.abort()
        return
      }

      const now     = new Date().toISOString()
      const updated = {
        ...existing,
        ...changes,
        updatedAt:  now,
        version:    existing.version + 1,
        syncStatus: 'pending',
        // Protect immutable fields
        id:         existing.id,
        createdAt:  existing.createdAt,
        deviceId:   existing.deviceId,
      }

      const queueEntry = buildQueueEntry(id, 'update', updated)

      incStore.put(updated)
      queueStore.add(queueEntry)

      tx.oncomplete = () => {
        console.log('[IDB] Incident updated:', id, 'v' + updated.version)
        resolve({ incident: updated, queueEntry })
      }
    }

    getReq.onerror   = (e) => reject(e.target.error)
    tx.onerror       = (e) => reject(e.target.error)
    tx.onabort       = ()  => reject(new Error('updateIncident transaction aborted'))
  })
}

// ─────────────────────────────────────────────────────────────
// deleteIncident(id)
//
// Soft-delete: sets status = 'closed', syncStatus = 'pending'.
// A hard delete would mean: incStore.delete(id) — not used here
// because we need to sync the deletion to the server.
// ─────────────────────────────────────────────────────────────
export async function deleteIncident(id) {
  return updateIncident(id, { status: 'closed' })
}

// ─────────────────────────────────────────────────────────────
// hardDeleteIncident(id)
//
// Permanently removes the incident from IndexedDB and queues a
// server DELETE. Used only if the record was never synced (syncStatus
// was 'pending' on a brand-new record the user wants to discard).
// ─────────────────────────────────────────────────────────────
export async function hardDeleteIncident(id) {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const tx         = db.transaction(['incidents', 'sync_queue'], 'readwrite')
    const incStore   = tx.objectStore('incidents')
    const queueStore = tx.objectStore('sync_queue')

    // Read first to build the queue entry payload before deleting
    const getReq = incStore.get(id)

    getReq.onsuccess = (e) => {
      const existing = e.target.result
      if (!existing) {
        resolve(null)   // already gone
        return
      }

      const queueEntry = buildQueueEntry(id, 'delete', existing)
      incStore.delete(id)
      queueStore.add(queueEntry)

      tx.oncomplete = () => {
        console.log('[IDB] Incident hard-deleted:', id)
        resolve(queueEntry)
      }
    }

    getReq.onerror = (e) => reject(e.target.error)
    tx.onerror     = (e) => reject(e.target.error)
    tx.onabort     = ()  => reject(new Error('hardDeleteIncident transaction aborted'))
  })
}

// ─────────────────────────────────────────────────────────────
// putIncident(incident)
//
// Low-level upsert used by the sync engine during pull-reconciliation:
// writes a full incident record received from the server without
// creating a sync_queue entry (it is already synced).
// ─────────────────────────────────────────────────────────────
export async function putIncident(incident) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('incidents', 'readwrite')
    const store = tx.objectStore('incidents')
    store.put({ ...incident, syncStatus: 'synced' })

    tx.oncomplete = () => resolve(incident)
    tx.onerror    = (e) => reject(e.target.error)
  })
}

// ─────────────────────────────────────────────────────────────
// updateIncidentSyncStatus(id, syncStatus)
//
// Used by the sync engine to mark an incident synced/failed/conflict
// without touching any other fields or creating a queue entry.
// ─────────────────────────────────────────────────────────────
export async function updateIncidentSyncStatus(id, syncStatus) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('incidents', 'readwrite')
    const store = tx.objectStore('incidents')
    const getReq = store.get(id)

    getReq.onsuccess = (e) => {
      const existing = e.target.result
      if (!existing) { resolve(null); return }
      store.put({ ...existing, syncStatus })
    }
    getReq.onerror = (e) => reject(e.target.error)
    tx.oncomplete  = () => resolve()
    tx.onerror     = (e) => reject(e.target.error)
  })
}

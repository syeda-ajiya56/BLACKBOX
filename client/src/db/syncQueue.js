// BLACKBOX — sync_queue store helpers
// All sync queue read/write operations go through these functions.
// Called internally by incidents.js (on every mutation) and by the sync engine.

import { openDB } from './indexedDB'
import { v4 as uuidv4 } from 'uuid'

// ─────────────────────────────────────────────────────────────
// Internal helper: wrap an IDBRequest in a Promise
// ─────────────────────────────────────────────────────────────
function req(idbRequest) {
  return new Promise((resolve, reject) => {
    idbRequest.onsuccess = (e) => resolve(e.target.result)
    idbRequest.onerror   = (e) => reject(e.target.error)
  })
}

// ─────────────────────────────────────────────────────────────
// enqueue(incidentId, operation, payload, tx?)
//
// Appends one item to sync_queue.
// If an open readwrite transaction (tx) is provided that already
// includes 'sync_queue', it is reused (for atomic incident+queue writes).
// Otherwise a new transaction is opened.
//
// operation: 'create' | 'update' | 'delete'
// payload:   full incident snapshot at time of mutation
// ─────────────────────────────────────────────────────────────
export async function enqueue(incidentId, operation, payload, tx = null) {
  const item = {
    queueId:      uuidv4(),
    incidentId,
    operation,
    payload:      { ...payload },   // snapshot — not a reference
    timestamp:    new Date().toISOString(),
    attempts:     0,
    status:       'pending',
    errorMessage: null,
  }

  if (tx) {
    // Reuse caller's transaction
    const store = tx.objectStore('sync_queue')
    store.put(item)           // fire-and-forget within the tx
    return item
  }

  const db = await openDB()
  await new Promise((resolve, reject) => {
    const t     = db.transaction('sync_queue', 'readwrite')
    const store = t.objectStore('sync_queue')
    store.put(item)
    t.oncomplete = () => resolve()
    t.onerror    = (e) => reject(e.target.error)
  })

  return item
}

// ─────────────────────────────────────────────────────────────
// getAllQueueItems()
// Returns all items, sorted by timestamp ascending (oldest first).
// ─────────────────────────────────────────────────────────────
export async function getAllQueueItems() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx      = db.transaction('sync_queue', 'readonly')
    const store   = tx.objectStore('sync_queue')
    const request = store.getAll()
    request.onsuccess = (e) => {
      const items = e.target.result
      items.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      resolve(items)
    }
    request.onerror = (e) => reject(e.target.error)
  })
}

// ─────────────────────────────────────────────────────────────
// getPendingItems()
// Returns queue items with status 'pending', oldest first.
// Used by the sync engine flush loop.
// ─────────────────────────────────────────────────────────────
export async function getPendingItems() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx      = db.transaction('sync_queue', 'readonly')
    const index   = tx.objectStore('sync_queue').index('status')
    const request = index.getAll('pending')
    request.onsuccess = (e) => {
      const items = e.target.result
      items.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      resolve(items)
    }
    request.onerror = (e) => reject(e.target.error)
  })
}

// ─────────────────────────────────────────────────────────────
// updateQueueItem(queueId, updates)
// Patches an existing queue item with the supplied fields.
// ─────────────────────────────────────────────────────────────
export async function updateQueueItem(queueId, updates) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('sync_queue', 'readwrite')
    const store = tx.objectStore('sync_queue')

    const getReq = store.get(queueId)

    getReq.onsuccess = (e) => {
      const existing = e.target.result
      if (!existing) {
        reject(new Error(`Queue item not found: ${queueId}`))
        return
      }
      const updated = { ...existing, ...updates }
      store.put(updated)
    }
    getReq.onerror = (e) => reject(e.target.error)

    tx.oncomplete = () => resolve()
    tx.onerror    = (e) => reject(e.target.error)
  })
}

// ─────────────────────────────────────────────────────────────
// retryQueueItem(queueId)
// Resets a 'failed' item back to 'pending' with attempts = 0.
// Called by the "Retry Now" button in SyncQueuePanel.
// ─────────────────────────────────────────────────────────────
export async function retryQueueItem(queueId) {
  return updateQueueItem(queueId, {
    status:       'pending',
    attempts:     0,
    errorMessage: null,
  })
}

// ─────────────────────────────────────────────────────────────
// countPending()
// Returns the number of items with status 'pending'.
// Used by the status bar pending count.
// ─────────────────────────────────────────────────────────────
export async function countPending() {
  const items = await getPendingItems()
  return items.length
}

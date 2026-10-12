// BLACKBOX — conflict_log IndexedDB store helpers
// This store is APPEND-ONLY — entries are never edited or deleted.
// Every conflict event produces one immutable entry here.
//
// FULL AUDIT ENTRY SCHEMA:
//   conflictId      UUID (primary key)
//   incidentId      Which incident conflicted
//   detectedAt      ISO8601 — when the 409 was received
//   resolvedAt      ISO8601 — when LWW resolution completed
//   rule            'LWW_UPDATED_AT' — always the same for now
//   localSnapshot   Full incident snapshot from local IndexedDB at conflict time
//   serverSnapshot  Full incident snapshot from 409 server response
//   winner          'local' | 'server'
//   loser           'server' | 'local'
//   reason          Human-readable LWW decision explanation
//   resolvedSnapshot The winning record (fields that were saved)
//   deviceId        Device that detected and resolved this conflict

import { openDB } from './indexedDB'
import { v4 as uuidv4 } from 'uuid'

// ─────────────────────────────────────────────────────────────
// appendConflictEntry({ incidentId, localSnapshot, serverSnapshot,
//                       winner, loser, reason, rule, resolvedSnapshot, deviceId })
//
// Appends one immutable entry to the conflict_log store.
// ─────────────────────────────────────────────────────────────
export async function appendConflictEntry({
  incidentId,
  localSnapshot,
  serverSnapshot,
  winner,
  loser,
  reason,
  rule        = 'LWW_UPDATED_AT',
  resolvedSnapshot,
  deviceId,
}) {
  const now = new Date().toISOString()

  const entry = {
    conflictId:       uuidv4(),
    incidentId,
    detectedAt:       now,
    resolvedAt:       now,     // detection and resolution happen in the same flush cycle
    rule,
    localSnapshot:    { ...localSnapshot },      // immutable snapshot
    serverSnapshot:   { ...serverSnapshot },     // immutable snapshot
    winner,
    loser,
    reason,
    resolvedSnapshot: { ...resolvedSnapshot },   // the record that was uploaded to server
    deviceId:         deviceId || localSnapshot?.deviceId || 'unknown',
  }

  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('conflict_log', 'readwrite')
    const store = tx.objectStore('conflict_log')

    // add() enforces uniqueness (conflictId is the keyPath).
    // If somehow called twice with the same conflictId, it throws rather
    // than silently overwriting — preserving append-only semantics.
    store.add(entry)

    tx.oncomplete = () => {
      console.log('[IDB] Conflict entry appended:', entry.conflictId,
        `(${entry.winner} won — ${entry.reason.slice(0, 60)}...)`)
      resolve(entry)
    }
    tx.onerror = (e) => reject(e.target.error)
  })
}

// ─────────────────────────────────────────────────────────────
// getAllConflictEntries()
// Returns all entries sorted by detectedAt descending (newest first).
// ─────────────────────────────────────────────────────────────
export async function getAllConflictEntries() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx      = db.transaction('conflict_log', 'readonly')
    const store   = tx.objectStore('conflict_log')
    const request = store.getAll()

    request.onsuccess = (e) => {
      const entries = e.target.result
      entries.sort((a, b) => new Date(b.detectedAt) - new Date(a.detectedAt))
      resolve(entries)
    }
    request.onerror = (e) => reject(e.target.error)
  })
}

// ─────────────────────────────────────────────────────────────
// getConflictEntriesForIncident(incidentId)
// Returns all entries for a specific incident, newest first.
// Used by IncidentDetail to show per-incident conflict history.
// ─────────────────────────────────────────────────────────────
export async function getConflictEntriesForIncident(incidentId) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx      = db.transaction('conflict_log', 'readonly')
    const index   = tx.objectStore('conflict_log').index('incidentId')
    const request = index.getAll(incidentId)

    request.onsuccess = (e) => {
      const entries = e.target.result
      entries.sort((a, b) => new Date(b.detectedAt) - new Date(a.detectedAt))
      resolve(entries)
    }
    request.onerror = (e) => reject(e.target.error)
  })
}

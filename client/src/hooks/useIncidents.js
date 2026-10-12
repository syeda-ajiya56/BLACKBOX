// BLACKBOX — useIncidents hook
// Loads incidents from IndexedDB into Zustand store.
// Exposes create, update, softDelete, hardDelete operations that
// write to IDB and keep the Zustand store in sync — no page refresh needed.

import { useEffect, useCallback } from 'react'
import {
  getAllIncidents,
  createIncident as idbCreate,
  updateIncident as idbUpdate,
  deleteIncident as idbSoftDelete,
  hardDeleteIncident as idbHardDelete,
} from '../db/incidents'
import { getAllQueueItems, retryQueueItem } from '../db/syncQueue'
import { getAllConflictEntries } from '../db/conflictLog'
import useAppStore from '../store/appStore'

export function useIncidents() {
  const {
    setIncidents,
    setSyncQueue,
    setConflictLog,
    setPendingCount,
    setDbLoading,
    setDbError,
  } = useAppStore()

  // ── Load all data from IndexedDB ───────────────────────────
  const loadAll = useCallback(async () => {
    setDbLoading(true)
    setDbError(null)
    try {
      const [incidents, queue, conflicts] = await Promise.all([
        getAllIncidents(),
        getAllQueueItems(),
        getAllConflictEntries(),
      ])
      setIncidents(incidents)
      setSyncQueue(queue)
      setConflictLog(conflicts)
      setPendingCount(queue.filter(q => q.status === 'pending').length)
    } catch (err) {
      console.error('[useIncidents] loadAll failed:', err)
      setDbError(err.message || 'Failed to load data from IndexedDB')
    } finally {
      setDbLoading(false)
    }
  }, [setIncidents, setSyncQueue, setConflictLog, setPendingCount, setDbLoading, setDbError])

  // Load on mount
  useEffect(() => {
    loadAll()
  }, [loadAll])

  // ── Create ─────────────────────────────────────────────────
  const createIncident = useCallback(async (fields) => {
    try {
      const { incident, queueEntry } = await idbCreate(fields)
      // Optimistically update Zustand store without re-reading all of IDB
      useAppStore.setState((s) => ({
        incidents:    [incident, ...s.incidents],
        syncQueue:    [queueEntry, ...s.syncQueue],
        pendingCount: s.pendingCount + 1,
      }))
      return incident
    } catch (err) {
      console.error('[useIncidents] createIncident failed:', err)
      throw err
    }
  }, [])

  // ── Update ─────────────────────────────────────────────────
  const updateIncident = useCallback(async (id, changes) => {
    try {
      const { incident, queueEntry } = await idbUpdate(id, changes)
      useAppStore.setState((s) => ({
        incidents:    s.incidents.map(i => i.id === id ? incident : i),
        syncQueue:    [queueEntry, ...s.syncQueue],
        pendingCount: s.pendingCount + 1,
      }))
      return incident
    } catch (err) {
      console.error('[useIncidents] updateIncident failed:', err)
      throw err
    }
  }, [])

  // ── Soft delete (status → closed) ─────────────────────────
  const softDeleteIncident = useCallback(async (id) => {
    try {
      const { incident, queueEntry } = await idbSoftDelete(id)
      useAppStore.setState((s) => ({
        incidents:    s.incidents.map(i => i.id === id ? incident : i),
        syncQueue:    [queueEntry, ...s.syncQueue],
        pendingCount: s.pendingCount + 1,
      }))
      return incident
    } catch (err) {
      console.error('[useIncidents] softDeleteIncident failed:', err)
      throw err
    }
  }, [])

  // ── Hard delete (removes from IDB entirely) ────────────────
  const hardDeleteIncident = useCallback(async (id) => {
    try {
      const queueEntry = await idbHardDelete(id)
      useAppStore.setState((s) => ({
        incidents:    s.incidents.filter(i => i.id !== id),
        syncQueue:    queueEntry ? [queueEntry, ...s.syncQueue] : s.syncQueue,
        pendingCount: queueEntry ? s.pendingCount + 1 : s.pendingCount,
      }))
    } catch (err) {
      console.error('[useIncidents] hardDeleteIncident failed:', err)
      throw err
    }
  }, [])

  // ── Retry a failed queue item ──────────────────────────────
  const retryQueueEntry = useCallback(async (queueId) => {
    try {
      await retryQueueItem(queueId)
      useAppStore.setState((s) => ({
        syncQueue: s.syncQueue.map(q =>
          q.queueId === queueId
            ? { ...q, status: 'pending', attempts: 0, errorMessage: null }
            : q
        ),
        pendingCount: s.pendingCount + 1,
      }))
    } catch (err) {
      console.error('[useIncidents] retryQueueEntry failed:', err)
      throw err
    }
  }, [])

  return {
    loadAll,
    createIncident,
    updateIncident,
    softDeleteIncident,
    hardDeleteIncident,
    retryQueueEntry,
  }
}

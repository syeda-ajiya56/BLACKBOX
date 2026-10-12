// BLACKBOX — useSyncQueue hook
// Reads sync queue state from Zustand (already populated by useIncidents).
// Exposes retry action wired to IDB.

import { useCallback } from 'react'
import { retryQueueItem } from '../db/syncQueue'
import useAppStore from '../store/appStore'

export function useSyncQueue() {
  const syncQueue = useAppStore((s) => s.syncQueue)

  const retryItem = useCallback(async (queueId) => {
    await retryQueueItem(queueId)
    useAppStore.setState((s) => ({
      syncQueue: s.syncQueue.map(q =>
        q.queueId === queueId
          ? { ...q, status: 'pending', attempts: 0, errorMessage: null }
          : q
      ),
      pendingCount: s.pendingCount + 1,
    }))
  }, [])

  return { syncQueue, retryItem }
}

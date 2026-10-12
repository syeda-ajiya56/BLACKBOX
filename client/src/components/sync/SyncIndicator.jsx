// BLACKBOX — SyncIndicator
// Compact widget used in the status bar (currently unused at top level —
// StatusBar handles its own display; this component is available for embedding).
import React from 'react'
import useAppStore from '../../store/appStore'

export default function SyncIndicator() {
  const { isSyncing, pendingCount, lastSyncedAt } = useAppStore()

  if (isSyncing) {
    return (
      <span className="bb-syncing-label" aria-live="polite" aria-label="Synchronising">
        <span className="bb-spinning" aria-hidden="true">⟳</span>
        Syncing…
      </span>
    )
  }

  if (pendingCount > 0) {
    return (
      <span className="bb-pending-badge" aria-label={`${pendingCount} pending`}>
        {pendingCount} pending
      </span>
    )
  }

  return (
    <span className="mono text-xs text-muted" aria-label="All synced">
      ✓ Synced
    </span>
  )
}

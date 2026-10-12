// BLACKBOX — StatusBar
// Shows: online/offline pill, offline-ready indicator, pending count,
// syncing spinner, last-synced time, sync error, and Sync Now button.
import React from 'react'
import useAppStore from '../../store/appStore'
import { flush } from '../../sync/syncEngine'
import './StatusBar.css'

function formatLastSynced(ts) {
  if (!ts) return 'Never'
  const diff = Date.now() - new Date(ts)
  const m    = Math.floor(diff / 60000)
  if (m < 1)  return 'Just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return new Date(ts).toLocaleDateString()
}

export default function StatusBar() {
  const {
    isOnline, isSyncing, lastSyncedAt,
    pendingCount, swReady, syncError,
  } = useAppStore()

  const handleSyncNow = () => {
    if (!isOnline || isSyncing) return
    flush()
  }

  return (
    <div className="bb-statusbar" role="status" aria-live="polite">

      {/* ── Online / Offline pill ── */}
      <span className={`bb-status-pill ${isOnline ? 'online' : 'offline'}`}>
        <span className="bb-status-dot" aria-hidden="true" />
        <span className="bb-status-label">{isOnline ? 'ONLINE' : 'OFFLINE'}</span>
      </span>

      {/* ── Offline-ready indicator (SW shell cached) ── */}
      {swReady && (
        <span
          className="bb-sw-ready"
          aria-label="App shell cached — available offline"
          title="Application shell is cached and available offline"
        >
          ◈ OFFLINE READY
        </span>
      )}

      {/* ── Pending count ── */}
      {pendingCount > 0 && !isSyncing && (
        <span className="bb-pending-badge" aria-label={`${pendingCount} pending sync items`}>
          {pendingCount} pending
        </span>
      )}

      {/* ── Syncing spinner ── */}
      {isSyncing && (
        <span className="bb-syncing-label" aria-label="Synchronising">
          <span className="bb-spinning" aria-hidden="true">⟳</span>
          <span>Syncing…</span>
        </span>
      )}

      {/* ── Sync error ── */}
      {syncError && !isSyncing && (
        <span
          className="bb-sync-error-label"
          aria-label={`Sync error: ${syncError}`}
          title={syncError}
        >
          ✗ Sync error
        </span>
      )}

      {/* ── Last synced ── */}
      <span
        className="bb-last-synced"
        aria-label={`Last synchronised: ${formatLastSynced(lastSyncedAt)}`}
      >
        {formatLastSynced(lastSyncedAt)}
      </span>

      {/* ── Sync Now button ── */}
      {isOnline && !isSyncing && (
        <button
          className="bb-btn bb-btn-ghost bb-btn-sm bb-sync-now-btn"
          onClick={handleSyncNow}
          aria-label="Sync pending changes to server"
          title="Sync Now"
        >
          ⟳ Sync
        </button>
      )}
    </div>
  )
}

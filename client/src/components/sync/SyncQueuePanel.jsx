// BLACKBOX — SyncQueuePanel
// Visualises all sync queue items with state badges.
// States: pending | syncing | synced | conflict | failed
// Retry Now: resets IDB item to pending then triggers a sync flush.
import React, { useState } from 'react'
import useAppStore from '../../store/appStore'
import { useIncidents } from '../../hooks/useIncidents'
import { flush } from '../../sync/syncEngine'
import './SyncQueuePanel.css'

const STATUS_FILTERS = [
  { id: 'all',      label: 'All' },
  { id: 'pending',  label: 'Pending' },
  { id: 'syncing',  label: 'Syncing' },
  { id: 'synced',   label: 'Synced' },
  { id: 'conflict', label: 'Conflict' },
  { id: 'failed',   label: 'Failed' },
]

const OP_LABELS = { create: 'CREATE', update: 'UPDATE', delete: 'DELETE' }

function formatDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function QueueItem({ item, onRetry }) {
  const { incidents, setView } = useAppStore()
  const inc = incidents.find(i => i.id === item.incidentId)
  const [retrying, setRetrying] = useState(false)

  const handleRetry = async () => {
    setRetrying(true)
    await onRetry(item.queueId)
    setRetrying(false)
  }

  return (
    <div className={`bb-queue-item bb-queue-item--${item.status}`} role="listitem">
      {/* Status indicator bar */}
      <div className="bb-queue-item__bar" aria-hidden="true" />

      <div className="bb-queue-item__body">
        {/* Top row */}
        <div className="bb-queue-item__top">
          <span className="bb-queue-item__op mono">{OP_LABELS[item.operation] ?? item.operation}</span>
          <span className={`badge-sync ${item.status}`}>{item.status}</span>
          {item.status === 'failed' && (
            <button
              className="bb-btn bb-btn-danger bb-btn-sm bb-retry-btn"
              onClick={handleRetry}
              disabled={retrying}
              aria-label={`Retry sync for ${inc?.incidentCode ?? item.incidentId}`}
            >
              {retrying ? '…' : '↺ Retry Now'}
            </button>
          )}
        </div>

        {/* Incident reference */}
        <div className="bb-queue-item__incident">
          {inc ? (
            <button
              className="bb-queue-item__incident-link"
              onClick={() => setView('incident-detail', inc.id)}
              aria-label={`View incident ${inc.incidentCode}`}
            >
              <span className="mono">{inc.incidentCode}</span>
              <span className="text-muted">{inc.driverName}</span>
            </button>
          ) : (
            <span className="mono text-muted">{item.incidentId}</span>
          )}
        </div>

        {/* Meta row */}
        <div className="bb-queue-item__meta">
          <span className="mono text-xs text-muted">
            Queued: {formatDateTime(item.timestamp)}
          </span>
          {item.attempts > 0 && (
            <span className="mono text-xs text-muted">
              {item.attempts} attempt{item.attempts !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Error message */}
        {item.errorMessage && (
          <p className="bb-queue-item__error mono text-xs">{item.errorMessage}</p>
        )}
      </div>
    </div>
  )
}

export default function SyncQueuePanel() {
  const { syncQueue, isOnline, isSyncing, lastSyncedAt, pendingCount } = useAppStore()
  const { retryQueueEntry } = useIncidents()
  const [filter, setFilter] = useState('all')

  // State counts for the summary
  const counts = STATUS_FILTERS
    .filter(f => f.id !== 'all')
    .reduce((acc, f) => {
      acc[f.id] = syncQueue.filter(q => q.status === f.id).length
      return acc
    }, {})

  const filtered = filter === 'all'
    ? [...syncQueue].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    : syncQueue
        .filter(q => q.status === filter)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))

  // Retry: reset IDB item to pending, then trigger a sync flush if online
  const handleRetry = async (queueId) => {
    try {
      await retryQueueEntry(queueId)
      // Attempt immediate sync so the user sees action right away
      const { isOnline } = useAppStore.getState()
      if (isOnline) flush()
    } catch (err) {
      console.error('[SyncQueuePanel] Retry failed:', err)
    }
  }

  const handleSyncNow = () => {
    const { isOnline, isSyncing } = useAppStore.getState()
    if (isOnline && !isSyncing) flush()
  }

  return (
    <div className="bb-sync-panel">
      {/* ── Header ── */}
      <div className="bb-sync-panel__header">
        <h1 className="bb-sync-panel__title">Sync Queue</h1>
        {isOnline && !isSyncing && (
          <button className="bb-btn bb-btn-primary" onClick={handleSyncNow}>
            ⟳ Sync Now
          </button>
        )}
        {isSyncing && (
          <span className="bb-syncing-label" aria-live="polite">
            <span className="bb-spinning" aria-hidden="true">⟳</span> Syncing…
          </span>
        )}
      </div>

      {/* ── Status summary ── */}
      <div className="bb-sync-panel__summary" role="region" aria-label="Queue summary">
        {[
          { id: 'pending',  label: 'Pending',  color: 'var(--bb-sync-pending)' },
          { id: 'syncing',  label: 'Syncing',  color: 'var(--bb-sync-syncing)' },
          { id: 'synced',   label: 'Synced',   color: 'var(--bb-sync-synced)'  },
          { id: 'conflict', label: 'Conflict', color: 'var(--bb-sync-conflict)' },
          { id: 'failed',   label: 'Failed',   color: 'var(--bb-sync-failed)'  },
        ].map(s => (
          <div
            key={s.id}
            className="bb-sync-summary-tile"
            style={{ '--tile-color': s.color }}
            aria-label={`${counts[s.id]} ${s.label}`}
          >
            <span className="bb-sync-summary-tile__value">{counts[s.id]}</span>
            <span className="bb-sync-summary-tile__label">{s.label}</span>
          </div>
        ))}
      </div>

      {/* ── Last synced ── */}
      <p className="bb-sync-panel__last-sync mono text-xs text-muted">
        Last sync: {lastSyncedAt
          ? new Date(lastSyncedAt).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: 'short' })
          : 'Never'}
        &nbsp;·&nbsp;
        {pendingCount} item{pendingCount !== 1 ? 's' : ''} pending
      </p>

      {/* ── Filter tabs ── */}
      <div className="bb-filter-row" role="tablist" aria-label="Filter queue by status">
        {STATUS_FILTERS.map(f => (
          <button
            key={f.id}
            role="tab"
            aria-selected={filter === f.id}
            className={`bb-filter-tab ${filter === f.id ? 'active' : ''}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
            {f.id !== 'all' && counts[f.id] > 0 && (
              <span className="bb-filter-tab__count">{counts[f.id]}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Queue list ── */}
      {filtered.length === 0 ? (
        <div className="bb-sync-empty" role="status">
          <span className="bb-sync-empty__mark" aria-hidden="true">⟳</span>
          <p className="bb-sync-empty__title">
            {filter === 'all' ? 'Queue Clear' : `No ${filter} items`}
          </p>
          <p className="bb-sync-empty__desc">
            {filter === 'all'
              ? 'All local changes are synchronised with the server.'
              : `No ${filter} items in the sync queue.`}
          </p>
        </div>
      ) : (
        <div className="bb-queue-list" role="list" aria-label="Sync queue items">
          {filtered.map(item => (
            <QueueItem key={item.queueId} item={item} onRetry={handleRetry} />
          ))}
        </div>
      )}
    </div>
  )
}

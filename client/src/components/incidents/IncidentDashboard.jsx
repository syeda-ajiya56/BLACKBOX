// BLACKBOX — Incident Dashboard
// Lists all incidents with filters, severity indicators, sync status badges.
// Data source: IndexedDB via Zustand store (populated by useIncidents hook in App.jsx).
import React, { useState } from 'react'
import useAppStore from '../../store/appStore'
import IncidentCard from './IncidentCard'
import './IncidentDashboard.css'

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 }

const FILTERS = [
  { id: 'all',          label: 'All' },
  { id: 'open',         label: 'Open' },
  { id: 'under_review', label: 'In Review' },
  { id: 'resolved',     label: 'Resolved' },
  { id: 'closed',       label: 'Closed' },
]

const SYNC_FILTERS = [
  { id: 'all',      label: 'All' },
  { id: 'pending',  label: 'Pending' },
  { id: 'conflict', label: 'Conflict' },
  { id: 'failed',   label: 'Failed' },
]

export default function IncidentDashboard() {
  const { incidents, setView, dbLoading, dbError } = useAppStore()

  // ── State — must be declared before any conditional returns ──
  const [statusFilter, setStatusFilter] = useState('all')
  const [syncFilter,   setSyncFilter]   = useState('all')
  const [searchQuery,  setSearchQuery]  = useState('')
  const [sortBy,       setSortBy]       = useState('updatedAt')

  // ── Loading state ──
  if (dbLoading) {
    return (
      <div className="bb-empty">
        <span className="bb-empty-icon bb-spinning" aria-hidden="true">⟳</span>
        <p className="bb-empty-title">Loading incidents…</p>
        <p className="bb-empty-desc mono text-xs">Reading from IndexedDB</p>
      </div>
    )
  }

  // ── Error state ──
  if (dbError) {
    return (
      <div className="bb-empty">
        <span className="bb-empty-icon" aria-hidden="true" style={{ color: 'var(--bb-sync-failed)' }}>✗</span>
        <p className="bb-empty-title" style={{ color: 'var(--bb-sync-failed)' }}>Database error</p>
        <p className="bb-empty-desc">{dbError}</p>
        <p className="bb-empty-desc text-xs mono">Open DevTools → Application → IndexedDB to inspect.</p>
      </div>
    )
  }

  // Derived counts for the summary strip
  const counts = {
    open:         incidents.filter(i => i.status === 'open').length,
    under_review: incidents.filter(i => i.status === 'under_review').length,
    critical:     incidents.filter(i => i.severity === 'critical').length,
    pending:      incidents.filter(i => i.syncStatus === 'pending').length,
  }

  // Filter + search + sort
  const filtered = incidents
    .filter(i => statusFilter === 'all' || i.status === statusFilter)
    .filter(i => syncFilter   === 'all' || i.syncStatus === syncFilter)
    .filter(i => {
      if (!searchQuery.trim()) return true
      const q = searchQuery.toLowerCase()
      return (
        i.incidentCode.toLowerCase().includes(q) ||
        i.driverName.toLowerCase().includes(q)   ||
        i.rideId.toLowerCase().includes(q)        ||
        i.location.toLowerCase().includes(q)      ||
        i.description.toLowerCase().includes(q)
      )
    })
    .sort((a, b) => {
      if (sortBy === 'severity') return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
      if (sortBy === 'updatedAt') return new Date(b.updatedAt) - new Date(a.updatedAt)
      if (sortBy === 'createdAt') return new Date(b.createdAt) - new Date(a.createdAt)
      return 0
    })

  return (
    <div className="bb-dashboard">
      {/* ── Page header ── */}
      <div className="bb-dashboard__header">
        <div className="bb-dashboard__title-row">
          <h1 className="bb-dashboard__title">Incident Board</h1>
          <button
            className="bb-btn bb-btn-primary"
            onClick={() => setView('new-incident')}
            aria-label="Create new incident"
          >
            + New Incident
          </button>
        </div>

        {/* Summary strip */}
        <div className="bb-dashboard__summary" role="region" aria-label="Incident summary">
          <div className="bb-summary-tile open-count">
            <span className="bb-summary-tile__value">{counts.open}</span>
            <span className="bb-summary-tile__label">Open</span>
          </div>
          <div className="bb-summary-tile review-count">
            <span className="bb-summary-tile__value">{counts.under_review}</span>
            <span className="bb-summary-tile__label">In Review</span>
          </div>
          <div className={`bb-summary-tile critical${counts.critical === 0 ? ' zero' : ''}`}>
            <span className="bb-summary-tile__value">{counts.critical}</span>
            <span className="bb-summary-tile__label">Critical</span>
          </div>
          <div className="bb-summary-tile pending">
            <span className="bb-summary-tile__value">{counts.pending}</span>
            <span className="bb-summary-tile__label">Pending</span>
          </div>
          <div className="bb-summary-tile total">
            <span className="bb-summary-tile__value">{incidents.length}</span>
            <span className="bb-summary-tile__label">Total</span>
          </div>
        </div>
      </div>

      {/* ── Controls row ── */}
      <div className="bb-dashboard__controls">
        {/* Search */}
        <div className="bb-search-wrap">
          <span className="bb-search-icon" aria-hidden="true">⌕</span>
          <input
            className="bb-input bb-search-input"
            type="search"
            placeholder="Search incidents, drivers, rides…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            aria-label="Search incidents"
          />
        </div>

        {/* Sort */}
        <select
          className="bb-select bb-sort-select"
          value={sortBy}
          onChange={e => setSortBy(e.target.value)}
          aria-label="Sort incidents"
        >
          <option value="updatedAt">Updated ↓</option>
          <option value="createdAt">Created ↓</option>
          <option value="severity">Severity ↓</option>
        </select>
      </div>

      {/* ── Status filter tabs ── */}
      <div className="bb-filter-row" role="tablist" aria-label="Filter by status">
        {FILTERS.map(f => (
          <button
            key={f.id}
            role="tab"
            aria-selected={statusFilter === f.id}
            className={`bb-filter-tab ${statusFilter === f.id ? 'active' : ''}`}
            onClick={() => setStatusFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
        {/* Sync filter sub-row */}
        {SYNC_FILTERS.filter(f => f.id !== 'all').map(f => (
          <button
            key={'sync-' + f.id}
            role="tab"
            aria-selected={syncFilter === f.id}
            className={`bb-filter-tab bb-filter-tab--sync ${syncFilter === f.id ? 'active' : ''}`}
            onClick={() => setSyncFilter(syncFilter === f.id ? 'all' : f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* ── Results count ── */}
      <p className="bb-dashboard__count mono text-xs text-muted">
        {filtered.length} incident{filtered.length !== 1 ? 's' : ''} shown
        {(statusFilter !== 'all' || syncFilter !== 'all' || searchQuery) && ' (filtered)'}
      </p>

      {/* ── Incident list ── */}
      {filtered.length === 0 ? (
        <div className="bb-dashboard-empty" role="status">
          <div className="bb-dashboard-empty__mark" aria-hidden="true">◈</div>
          <p className="bb-dashboard-empty__title">
            {searchQuery ? 'No results found' : 'No active incidents'}
          </p>
          <p className="bb-dashboard-empty__sub">
            {searchQuery ? `"${searchQuery}"` : 'Incident board is clear'}
          </p>
          <p className="bb-dashboard-empty__desc">
            {searchQuery
              ? 'Try adjusting your search or clearing the filter.'
              : 'Incident intelligence will appear here when operational events are recorded.'}
          </p>
          {!searchQuery && (
            <button className="bb-btn bb-btn-primary" onClick={() => setView('new-incident')}>
              + New Incident
            </button>
          )}
        </div>
      ) : (
        <div className="bb-incident-list" role="list">
          {filtered.map(incident => (
            <IncidentCard key={incident.id} incident={incident} />
          ))}
        </div>
      )}
    </div>
  )
}

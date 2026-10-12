// BLACKBOX — ConflictLog
// Append-only audit trail loaded from IndexedDB conflict_log store.
// Every entry was written by syncEngine._handleConflict() at resolution time.
import React, { useState } from 'react'
import useAppStore from '../../store/appStore'
import './ConflictLog.css'

function fmtDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

const DIFF_FIELDS = [
  { key: 'severity',    label: 'Severity' },
  { key: 'status',      label: 'Status' },
  { key: 'description', label: 'Description' },
  { key: 'location',    label: 'Location' },
  { key: 'incidentType',label: 'Type' },
  { key: 'updatedAt',   label: 'Updated At' },
  { key: 'deviceId',    label: 'Device ID' },
  { key: 'version',     label: 'Version' },
]

// ─────────────────────────────────────────────────────────────
// ConflictEntry — one audit log card
// ─────────────────────────────────────────────────────────────
function ConflictEntry({ entry }) {
  const { setView } = useAppStore()
  const [expanded, setExpanded] = useState(false)

  const {
    conflictId, incidentId,
    detectedAt, resolvedAt,
    rule, winner, loser, reason,
    localSnapshot, serverSnapshot, resolvedSnapshot,
    deviceId,
  } = entry

  const incCode   = localSnapshot?.incidentCode ?? incidentId
  const winnerTs  = winner === 'local' ? localSnapshot?.updatedAt : serverSnapshot?.updatedAt
  const loserTs   = winner === 'local' ? serverSnapshot?.updatedAt : localSnapshot?.updatedAt

  return (
    <article
      className={`bb-conflict-log-entry bb-conflict-log-entry--${winner}`}
      role="listitem"
      aria-label={`Conflict on ${incCode}`}
    >
      {/* ── Header ── */}
      <div className="bb-conflict-log-entry__header">
        <div className="bb-conflict-log-entry__title-row">
          <span className="bb-conflict-log-entry__icon" aria-hidden="true">⚡</span>
          <span className="bb-conflict-log-entry__code mono">{incCode}</span>
          <span className={`bb-conflict-log-entry__winner-badge ${winner}`}>
            {winner === 'local' ? '▲ LOCAL WON' : '▼ SERVER WON'}
          </span>
          <span className="bb-conflict-log-entry__rule mono text-xs">{rule}</span>
        </div>
        <div className="bb-conflict-log-entry__times">
          <span className="mono text-xs text-muted">Detected: {fmtDateTime(detectedAt)}</span>
          {resolvedAt && resolvedAt !== detectedAt && (
            <span className="mono text-xs text-muted">Resolved: {fmtDateTime(resolvedAt)}</span>
          )}
          {deviceId && (
            <span className="mono text-xs text-muted">Device: {String(deviceId).slice(0,16)}…</span>
          )}
        </div>
      </div>

      {/* ── Reason ── */}
      <p className="bb-conflict-log-entry__resolution">{reason}</p>

      {/* ── Timestamp comparison ── */}
      <div className="bb-conflict-log-entry__timestamps">
        <div className={`bb-conflict-ts ${winner === 'local' ? 'bb-conflict-ts--local winner' : 'bb-conflict-ts--local'}`}>
          <span className="bb-conflict-ts__label">
            LOCAL {winner === 'local' && '★'}
          </span>
          <span className="mono text-xs">{localSnapshot?.updatedAt?.slice(11,23) ?? '—'}</span>
        </div>
        <span className="bb-conflict-ts__vs" aria-hidden="true">vs</span>
        <div className={`bb-conflict-ts ${winner === 'server' ? 'bb-conflict-ts--server winner' : 'bb-conflict-ts--server'}`}>
          <span className="bb-conflict-ts__label">
            SERVER {winner === 'server' && '★'}
          </span>
          <span className="mono text-xs">{serverSnapshot?.updatedAt?.slice(11,23) ?? '—'}</span>
        </div>
      </div>

      {/* ── Expand / collapse ── */}
      <button
        className="bb-conflict-log-entry__expand-btn"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
        aria-controls={`diff-${conflictId}`}
      >
        {expanded ? '▲ Hide field diff' : '▼ Show field diff'}
      </button>

      {expanded && (
        <div id={`diff-${conflictId}`} className="bb-conflict-diff" role="table" aria-label="Field comparison">
          {/* Header row */}
          <div className="bb-conflict-diff__row bb-conflict-diff__row--header" role="row">
            <span className="bb-conflict-diff__col-label" role="columnheader">Field</span>
            <span className={`bb-conflict-diff__col-label ${winner === 'local' ? 'winner' : ''}`} role="columnheader">
              Local {winner === 'local' && '★'}
            </span>
            <span className={`bb-conflict-diff__col-label ${winner === 'server' ? 'winner' : ''}`} role="columnheader">
              Server {winner === 'server' && '★'}
            </span>
          </div>

          {DIFF_FIELDS.map(({ key, label }) => {
            const lv = localSnapshot?.[key]
            const sv = serverSnapshot?.[key]
            if (lv === sv) return null   // only show differing fields
            return (
              <div key={key} className="bb-conflict-diff__row bb-conflict-diff__row--diff" role="row">
                <span className="bb-conflict-diff__field mono" role="cell">{label}</span>
                <span
                  className={`bb-conflict-diff__val ${winner === 'local' ? 'winner' : 'loser'}`}
                  role="cell"
                >
                  {winner === 'local' && <span className="bb-conflict-diff__win-marker">★</span>}
                  {lv !== undefined ? String(lv) : '—'}
                </span>
                <span
                  className={`bb-conflict-diff__val ${winner === 'server' ? 'winner' : 'loser'}`}
                  role="cell"
                >
                  {winner === 'server' && <span className="bb-conflict-diff__win-marker">★</span>}
                  {sv !== undefined ? String(sv) : '—'}
                </span>
              </div>
            )
          })}

          {/* Resolved snapshot summary */}
          {resolvedSnapshot && (
            <div className="bb-conflict-diff__resolved">
              <span className="bb-conflict-diff__resolved-label">RESOLVED STATE</span>
              <span className="mono text-xs">
                v{resolvedSnapshot.version} · {resolvedSnapshot.updatedAt?.slice(11,23)}
                · {resolvedSnapshot.severity} · {resolvedSnapshot.status}
              </span>
            </div>
          )}

          <p className="bb-conflict-diff__note text-xs text-muted">
            Only differing fields shown. LWW uses client-set{' '}
            <span className="mono">updatedAt</span> — clock skew is a known limitation.
          </p>
        </div>
      )}

      {/* ── Actions ── */}
      <div className="bb-conflict-log-entry__actions">
        <button
          className="bb-btn bb-btn-ghost bb-btn-sm"
          onClick={() => setView('incident-detail', incidentId)}
          aria-label={`View incident ${incCode}`}
        >
          View Incident
        </button>
      </div>
    </article>
  )
}

// ─────────────────────────────────────────────────────────────
// ConflictLog page
// ─────────────────────────────────────────────────────────────
export default function ConflictLog() {
  // conflictLog is populated from IDB by useIncidents hook on mount
  // and after every sync flush via _refreshStoreFromIDB().
  const { conflictLog, dbLoading } = useAppStore()

  const sorted = [...conflictLog].sort(
    (a, b) => new Date(b.detectedAt) - new Date(a.detectedAt)
  )

  return (
    <div className="bb-conflict-log-page">
      {/* ── Header ── */}
      <div className="bb-conflict-log-page__header">
        <h1 className="bb-conflict-log-page__title">Conflict Log</h1>
        <p className="bb-conflict-log-page__desc text-sm text-muted">
          Immutable audit trail of every sync conflict detected on this device.
          All conflicts are automatically resolved using Last-Write-Wins on{' '}
          <span className="mono">updatedAt</span>.
        </p>
      </div>

      {/* ── LWW rule explanation ── */}
      <div className="bb-lww-info" role="note">
        <span className="bb-lww-info__icon" aria-hidden="true">ℹ</span>
        <div className="text-xs" style={{ lineHeight: '1.6' }}>
          <strong>Rule: LWW_UPDATED_AT</strong> — The record with the later{' '}
          <span className="mono">updatedAt</span> timestamp wins.
          Equal timestamps: lexicographically greater <span className="mono">deviceId</span> wins.{' '}
          <strong>Known limitation:</strong> client clock skew means a device with a fast
          clock tends to win regardless of actual edit order.
        </div>
      </div>

      {/* ── Loading ── */}
      {dbLoading ? (
        <div className="bb-conflict-log-empty">
          <div className="bb-conflict-log-empty__mark bb-spinning" aria-hidden="true">⟳</div>
          <p className="bb-conflict-log-empty__title">Loading conflict log…</p>
          <p className="bb-conflict-log-empty__desc mono text-xs">Reading from IndexedDB</p>
        </div>
      ) : sorted.length === 0 ? (
        <div className="bb-conflict-log-empty">
          <div className="bb-conflict-log-empty__mark" aria-hidden="true">⚡</div>
          <p className="bb-conflict-log-empty__title">No conflicts recorded</p>
          <p className="bb-conflict-log-empty__desc">
            Conflicts are automatically resolved and logged here when two devices
            edit the same incident while offline. Run the two-browser test in
            docs/test-plan.md to generate a conflict.
          </p>
        </div>
      ) : (
        <>
          <p className="bb-conflict-log-page__count mono text-xs text-muted">
            {sorted.length} conflict{sorted.length !== 1 ? 's' : ''} recorded on this device
          </p>
          <div className="bb-conflict-log-list" role="list" aria-label="Conflict log entries">
            {sorted.map(entry => (
              <ConflictEntry key={entry.conflictId} entry={entry} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

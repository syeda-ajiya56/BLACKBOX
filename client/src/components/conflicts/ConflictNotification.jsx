// BLACKBOX — ConflictNotification
// Shown automatically when the sync engine resolves a 409 conflict.
// The conflict is ALREADY RESOLVED when this banner appears —
// it reports the outcome rather than asking the user to decide.
// Must be acknowledged before it clears.
import React, { useState } from 'react'
import useAppStore from '../../store/appStore'
import './ConflictNotification.css'

function fmt(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

const COMPARED_FIELDS = [
  { key: 'severity',    label: 'Severity' },
  { key: 'status',      label: 'Status' },
  { key: 'description', label: 'Description' },
  { key: 'location',    label: 'Location' },
  { key: 'updatedAt',   label: 'Updated At' },
  { key: 'deviceId',    label: 'Device ID' },
  { key: 'version',     label: 'Version' },
]

export default function ConflictNotification({ conflict, onAcknowledge }) {
  const { setView }   = useAppStore()
  const [expanded, setExpanded] = useState(false)

  if (!conflict) return null

  const {
    conflictId, incidentId,
    winner, loser, rule, resolution,
    localRecord, serverRecord, resolvedRecord,
    detectedAt, resolvedAt,
  } = conflict

  const winnerLabel  = winner === 'local'  ? '▲ LOCAL WON'  : '▼ SERVER WON'
  const winnerSnap   = winner === 'local'  ? localRecord    : serverRecord
  const loserSnap    = winner === 'local'  ? serverRecord   : localRecord
  const winnerSide   = winner === 'local'  ? 'LOCAL'        : 'SERVER'
  const loserSide    = winner === 'local'  ? 'SERVER'       : 'LOCAL'

  return (
    <div
      className={`bb-conflict-banner bb-conflict-banner--${winner}`}
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      aria-label={`Conflict resolved: ${winnerLabel}`}
    >
      {/* ── Header ── */}
      <div className="bb-conflict-banner__header">
        <div className="bb-conflict-banner__title-row">
          <span className="bb-conflict-banner__icon" aria-hidden="true">⚡</span>
          <span className="bb-conflict-banner__title">CONFLICT DETECTED + RESOLVED</span>
          <span className="bb-conflict-banner__time mono">{fmt(detectedAt)}</span>
        </div>

        <div className="bb-conflict-banner__meta-row">
          <span className="mono text-xs" aria-label="Incident code">
            {winnerSnap?.incidentCode ?? incidentId}
          </span>
          <span className={`bb-conflict-banner__winner-tag ${winner}`}>
            {winnerLabel}
          </span>
          <span className="bb-conflict-banner__rule mono text-xs">
            {rule ?? 'LWW_UPDATED_AT'}
          </span>
        </div>
      </div>

      {/* ── Resolution reason ── */}
      <p className="bb-conflict-banner__resolution">{resolution}</p>

      {/* ── Timestamps at a glance ── */}
      <div className="bb-conflict-banner__ts-row">
        <div className={`bb-conflict-banner__ts-block ${winner === 'local' ? 'winner' : 'loser'}`}>
          <span className="bb-conflict-banner__ts-label">LOCAL</span>
          <span className="mono text-xs">{localRecord?.updatedAt?.slice(11,23) ?? '—'}</span>
        </div>
        <span className="bb-conflict-banner__ts-sep" aria-hidden="true">vs</span>
        <div className={`bb-conflict-banner__ts-block ${winner === 'server' ? 'winner' : 'loser'}`}>
          <span className="bb-conflict-banner__ts-label">SERVER</span>
          <span className="mono text-xs">{serverRecord?.updatedAt?.slice(11,23) ?? '—'}</span>
        </div>
      </div>

      {/* ── Expandable side-by-side comparison ── */}
      <button
        className="bb-conflict-banner__expand-btn"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
      >
        {expanded ? '▲ Hide comparison' : '▼ Show side-by-side comparison'}
      </button>

      {expanded && (
        <div className="bb-conflict-snap" aria-label="Conflict snapshot comparison">
          {/* Column headers */}
          <div className="bb-conflict-snap__grid bb-conflict-snap__grid--header">
            <span className="bb-conflict-snap__col-head">Field</span>
            <span className={`bb-conflict-snap__col-head ${winner === 'local' ? 'winner' : ''}`}>
              LOCAL {winner === 'local' && <span className="bb-conflict-snap__win-tag">★ WINNER</span>}
            </span>
            <span className={`bb-conflict-snap__col-head ${winner === 'server' ? 'winner' : ''}`}>
              SERVER {winner === 'server' && <span className="bb-conflict-snap__win-tag">★ WINNER</span>}
            </span>
          </div>

          {COMPARED_FIELDS.map(({ key, label }) => {
            const lv = localRecord?.[key]
            const sv = serverRecord?.[key]
            const differs = String(lv) !== String(sv)
            return (
              <div
                key={key}
                className={`bb-conflict-snap__grid ${differs ? 'bb-conflict-snap__grid--diff' : ''}`}
              >
                <span className="bb-conflict-snap__field mono">{label}</span>
                <span className={`bb-conflict-snap__val ${winner === 'local' && differs ? 'winner' : ''}`}>
                  {lv !== undefined ? String(lv) : '—'}
                </span>
                <span className={`bb-conflict-snap__val ${winner === 'server' && differs ? 'winner' : ''}`}>
                  {sv !== undefined ? String(sv) : '—'}
                </span>
              </div>
            )
          })}

          <p className="bb-conflict-snap__note text-xs text-muted">
            ⚠ LWW uses client-set <span className="mono">updatedAt</span>. Clock skew
            is a known limitation — a device with a fast clock may win regardless of
            actual edit order. All decisions are logged in the Conflict Log.
          </p>
        </div>
      )}

      {/* ── Actions ── */}
      <div className="bb-conflict-banner__actions">
        <button
          className="bb-btn bb-btn-ghost bb-btn-sm"
          onClick={() => { setView('conflict-log'); onAcknowledge() }}
        >
          Conflict Log
        </button>
        <button
          className="bb-btn bb-btn-ghost bb-btn-sm"
          onClick={() => { setView('incident-detail', incidentId); onAcknowledge() }}
        >
          View Incident
        </button>
        <button
          className="bb-btn bb-btn-primary bb-btn-sm"
          onClick={onAcknowledge}
        >
          Acknowledge
        </button>
      </div>
    </div>
  )
}

// BLACKBOX — IncidentDetail
// Full-detail view. Data comes from Zustand (populated from IDB by useIncidents).
// Conflict history reads from the conflictLog array in the store (loaded from IDB).
import React from 'react'
import useAppStore from '../../store/appStore'
import { useIncidents } from '../../hooks/useIncidents'
import './IncidentDetail.css'

const TYPE_LABELS = {
  collision:        'Collision',
  passenger_dispute:'Passenger Dispute',
  breakdown:        'Breakdown',
  theft:            'Theft',
  medical:          'Medical Emergency',
  route_deviation:  'Route Deviation',
  other:            'Other',
}

function formatDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function MetaRow({ label, value, mono = false }) {
  return (
    <div className="bb-detail__meta-row">
      <span className="bb-detail__meta-label">{label}</span>
      <span className={`bb-detail__meta-value ${mono ? 'mono' : ''}`}>{value ?? '—'}</span>
    </div>
  )
}

export default function IncidentDetail({ incidentId }) {
  const { incidents, syncQueue, conflictLog, setView } = useAppStore()
  const { softDeleteIncident, hardDeleteIncident } = useIncidents()
  const [deleting, setDeleting] = React.useState(false)

  // conflictLog is populated from IDB by useIncidents hook on mount
  // and refreshed after every sync flush.
  const conflicts = conflictLog.filter(c => c.incidentId === incidentId)

  const incident = incidents.find(i => i.id === incidentId)

  if (!incident) {
    return (
      <div className="bb-empty">
        <span className="bb-empty-icon" aria-hidden="true">◈</span>
        <p className="bb-empty-title">Incident not found</p>
        <button className="bb-btn bb-btn-ghost" onClick={() => setView('dashboard')}>
          ← Back to dashboard
        </button>
      </div>
    )
  }

  // All queue entries for this incident
  const queueEntries = syncQueue.filter(q => q.incidentId === incidentId)

  const {
    incidentCode, rideId, driverName, vehicleId,
    incidentType, severity, description, location,
    status, createdAt, updatedAt, version, deviceId, syncStatus,
  } = incident

  return (
    <div className="bb-detail-page">
      {/* ── Header ── */}
      <div className="bb-detail-page__header">
        <button
          className="bb-btn bb-btn-ghost bb-btn-sm"
          onClick={() => setView('dashboard')}
          aria-label="Back to dashboard"
        >
          ← Back
        </button>
        <div className="bb-detail-page__title-row">
          <h1 className="bb-detail-page__code mono">{incidentCode}</h1>
          <div className="bb-detail-page__badges">
            <span className={`badge-severity ${severity}`}>{severity}</span>
            <span className={`badge-status ${status}`}>{status.replace('_', ' ')}</span>
            <span className={`badge-sync ${syncStatus}`}>{syncStatus}</span>
          </div>
        </div>
        <button
          className="bb-btn bb-btn-ghost bb-btn-sm"
          onClick={() => setView('edit-incident', incidentId)}
          aria-label={`Edit ${incidentCode}`}
        >
          ✎ Edit
        </button>
        <button
          className="bb-btn bb-btn-danger bb-btn-sm"
          onClick={async () => {
            if (!window.confirm(`Close incident ${incidentCode}? This marks it closed and queues a sync.`)) return
            setDeleting(true)
            try {
              await softDeleteIncident(incidentId)
              setView('dashboard')
            } finally {
              setDeleting(false)
            }
          }}
          disabled={deleting || status === 'closed'}
          aria-label={`Close incident ${incidentCode}`}
        >
          {deleting ? '…' : '✕ Close'}
        </button>
      </div>

      <div className="bb-detail-page__body">
        {/* ── Main info ── */}
        <section className="bb-card bb-detail__section" aria-labelledby="detail-info-heading">
          <h2 id="detail-info-heading" className="bb-detail__section-heading">
            {TYPE_LABELS[incidentType] || incidentType}
          </h2>
          <p className="bb-detail__description">{description}</p>
          <div className="bb-detail__location">
            <span aria-hidden="true">⌖</span>
            <span>{location}</span>
          </div>
        </section>

        {/* ── Personnel & vehicle ── */}
        <section className="bb-card bb-detail__section" aria-labelledby="detail-personnel-heading">
          <h2 id="detail-personnel-heading" className="bb-detail__section-heading">Personnel &amp; Vehicle</h2>
          <div className="bb-detail__meta-grid">
            <MetaRow label="Driver"       value={driverName} />
            <MetaRow label="Vehicle"      value={vehicleId}  mono />
            <MetaRow label="Ride ID"      value={rideId}     mono />
          </div>
        </section>

        {/* ── Sync metadata ── */}
        <section className="bb-card bb-detail__section" aria-labelledby="detail-sync-heading">
          <h2 id="detail-sync-heading" className="bb-detail__section-heading">Sync Metadata</h2>
          <div className="bb-detail__meta-grid">
            <MetaRow label="Sync Status"  value={syncStatus}           mono />
            <MetaRow label="Version"      value={`v${version}`}        mono />
            <MetaRow label="Device ID"    value={deviceId}             mono />
            <MetaRow label="Created"      value={formatDateTime(createdAt)} />
            <MetaRow label="Last Updated" value={formatDateTime(updatedAt)} />
          </div>
        </section>

        {/* ── Sync queue history ── */}
        <section className="bb-card bb-detail__section" aria-labelledby="detail-queue-heading">
          <h2 id="detail-queue-heading" className="bb-detail__section-heading">Sync Queue History</h2>
          {queueEntries.length === 0 ? (
            <p className="bb-detail__empty-note">No queue entries for this incident.</p>
          ) : (
            <div className="bb-timeline">
              {queueEntries.map(q => (
                <div key={q.queueId} className={`bb-timeline__entry bb-timeline__entry--${q.status}`}>
                  <div className="bb-timeline__dot" aria-hidden="true" />
                  <div className="bb-timeline__content">
                    <div className="bb-timeline__row">
                      <span className="bb-timeline__op mono">{q.operation.toUpperCase()}</span>
                      <span className={`badge-sync ${q.status}`}>{q.status}</span>
                      <span className="bb-timeline__time mono text-xs text-muted">
                        {formatDateTime(q.timestamp)}
                      </span>
                    </div>
                    {q.attempts > 0 && (
                      <p className="bb-timeline__attempts text-xs text-muted">
                        {q.attempts} attempt{q.attempts !== 1 ? 's' : ''}
                      </p>
                    )}
                    {q.errorMessage && (
                      <p className="bb-timeline__error text-xs">{q.errorMessage}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Conflict history ── */}
        {conflicts.length > 0 && (
          <section className="bb-card bb-detail__section bb-detail__section--conflict" aria-labelledby="detail-conflict-heading">
            <h2 id="detail-conflict-heading" className="bb-detail__section-heading bb-detail__section-heading--conflict">
              ⚡ Conflict History ({conflicts.length})
            </h2>
            {conflicts.map(c => {
              // Support both old schema (localRecord/serverRecord) and new (localSnapshot/serverSnapshot)
              const localSnap  = c.localSnapshot  ?? c.localRecord
              const serverSnap = c.serverSnapshot ?? c.serverRecord
              const reason     = c.reason ?? c.resolution
              return (
                <div key={c.conflictId} className="bb-conflict-entry">
                  <div className="bb-conflict-entry__header">
                    <span className="mono text-xs text-muted">
                      Detected: {formatDateTime(c.detectedAt)}
                    </span>
                    {c.resolvedAt && (
                      <span className="mono text-xs text-muted">
                        Resolved: {formatDateTime(c.resolvedAt)}
                      </span>
                    )}
                    <span className={`badge-sync ${c.winner === 'local' ? 'conflict' : 'syncing'}`}>
                      {c.winner === 'local' ? '▲ LOCAL WON' : '▼ SERVER WON'}
                    </span>
                    {c.rule && (
                      <span className="mono text-xs text-muted">{c.rule}</span>
                    )}
                  </div>
                  <p className="bb-conflict-entry__resolution text-sm">{reason}</p>
                  <div className="bb-conflict-snapshots">
                    <div className={`bb-conflict-snapshot ${c.winner === 'local' ? 'bb-conflict-snapshot--winner' : ''}`}>
                      <p className="bb-conflict-snapshot__label">
                        Local {c.winner === 'local' && '★ WINNER'}
                      </p>
                      <p className="mono text-xs">v{localSnap?.version} · {localSnap?.updatedAt?.slice(11,19)}</p>
                      <p className="text-xs text-muted">{localSnap?.severity} · {localSnap?.status}</p>
                    </div>
                    <div className={`bb-conflict-snapshot bb-conflict-snapshot--server ${c.winner === 'server' ? 'bb-conflict-snapshot--winner' : ''}`}>
                      <p className="bb-conflict-snapshot__label">
                        Server {c.winner === 'server' && '★ WINNER'}
                      </p>
                      <p className="mono text-xs">v{serverSnap?.version} · {serverSnap?.updatedAt?.slice(11,19)}</p>
                      <p className="text-xs text-muted">{serverSnap?.severity} · {serverSnap?.status}</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </section>
        )}
      </div>
    </div>
  )
}

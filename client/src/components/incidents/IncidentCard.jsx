// BLACKBOX — IncidentCard
import React from 'react'
import useAppStore from '../../store/appStore'
import './IncidentCard.css'

function timeAgo(isoString) {
  const diff = Date.now() - new Date(isoString)
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const TYPE_LABELS = {
  collision:         'Collision',
  passenger_dispute: 'Passenger Dispute',
  breakdown:         'Breakdown',
  theft:             'Theft',
  medical:           'Medical Emergency',
  route_deviation:   'Route Deviation',
  other:             'Other',
}

export default function IncidentCard({ incident }) {
  const { setView } = useAppStore()
  const {
    id, incidentCode, rideId, driverName, vehicleId,
    incidentType, severity, description, location,
    status, updatedAt, syncStatus,
  } = incident

  return (
    <article
      className={`bb-card bb-incident-card bb-incident-card--${severity}`}
      role="listitem"
      aria-label={`Incident ${incidentCode}, ${severity} severity`}
    >
      {/* ── Severity top bar ── */}
      <div className="bb-incident-card__severity-bar" aria-hidden="true" />

      <div className="bb-incident-card__body">
        {/* ── Header: code + badges ── */}
        <div className="bb-incident-card__header">
          <div className="bb-incident-card__codes">
            <span className="bb-incident-card__code mono">{incidentCode}</span>
            <span className="bb-incident-card__ride mono">#{rideId}</span>
          </div>
          <div className="bb-incident-card__badges">
            <span className={`badge-severity ${severity}`}>{severity}</span>
            <span className={`badge-sync ${syncStatus}`}>{syncStatus}</span>
          </div>
        </div>

        {/* ── Type ── */}
        <p className="bb-incident-card__type">
          {TYPE_LABELS[incidentType] || incidentType}
        </p>

        {/* ── Description ── */}
        <p className="bb-incident-card__desc">{description}</p>

        {/* ── Meta ── */}
        <div className="bb-incident-card__meta">
          <span className="bb-incident-card__meta-item">
            <span className="bb-incident-card__meta-icon" aria-hidden="true">◉</span>
            {driverName}
          </span>
          <span className="bb-incident-card__meta-item">
            <span className="bb-incident-card__meta-icon" aria-hidden="true">▣</span>
            {vehicleId}
          </span>
          <span className="bb-incident-card__meta-item">
            <span className="bb-incident-card__meta-icon" aria-hidden="true">⌖</span>
            {location}
          </span>
        </div>

        {/* ── Footer ── */}
        <div className="bb-incident-card__footer">
          <span className={`badge-status ${status}`}>{status.replace('_', ' ')}</span>
          <span className="bb-incident-card__time">{timeAgo(updatedAt)}</span>
          <div className="bb-incident-card__actions">
            <button
              className="bb-btn bb-btn-ghost bb-btn-sm"
              onClick={() => setView('incident-detail', id)}
              aria-label={`View details for ${incidentCode}`}
            >
              View
            </button>
            <button
              className="bb-btn bb-btn-ghost bb-btn-sm"
              onClick={() => setView('edit-incident', id)}
              aria-label={`Edit ${incidentCode}`}
            >
              Edit
            </button>
          </div>
        </div>
      </div>
    </article>
  )
}

// BLACKBOX — IncidentForm
// Handles both create and edit modes.
// Writes to IndexedDB via useIncidents hook (which also creates sync_queue entry).
import React, { useState, useEffect } from 'react'
import useAppStore from '../../store/appStore'
import { useIncidents } from '../../hooks/useIncidents'
import './IncidentForm.css'

const INCIDENT_TYPES = [
  { value: 'collision',         label: 'Collision' },
  { value: 'passenger_dispute', label: 'Passenger Dispute' },
  { value: 'breakdown',         label: 'Breakdown' },
  { value: 'theft',             label: 'Theft' },
  { value: 'medical',           label: 'Medical Emergency' },
  { value: 'route_deviation',   label: 'Route Deviation' },
  { value: 'other',             label: 'Other' },
]

const SEVERITIES = [
  { value: 'low',      label: 'Low' },
  { value: 'medium',   label: 'Medium' },
  { value: 'high',     label: 'High' },
  { value: 'critical', label: 'Critical' },
]

const STATUSES = [
  { value: 'open',         label: 'Open' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'resolved',     label: 'Resolved' },
  { value: 'closed',       label: 'Closed' },
]

const EMPTY_FORM = {
  incidentCode: '',
  rideId:       '',
  driverName:   '',
  vehicleId:    '',
  incidentType: 'collision',
  severity:     'medium',
  description:  '',
  location:     '',
  status:       'open',
}

function generateCode() {
  const year = new Date().getFullYear()
  const num  = String(Math.floor(Math.random() * 90000) + 10000)
  return `INC-${year}-${num}`
}

function validate(fields) {
  const errors = {}
  if (!fields.incidentCode.trim()) errors.incidentCode = 'Incident code is required'
  if (!fields.rideId.trim())       errors.rideId       = 'Ride ID is required'
  if (!fields.driverName.trim())   errors.driverName   = 'Driver name is required'
  if (!fields.vehicleId.trim())    errors.vehicleId    = 'Vehicle ID is required'
  if (!fields.description.trim())  errors.description  = 'Description is required'
  if (!fields.location.trim())     errors.location     = 'Location is required'
  return errors
}

export default function IncidentForm({ mode = 'create', incidentId = null }) {
  const { incidents, setView, isOnline } = useAppStore()
  const { createIncident, updateIncident } = useIncidents()

  const existingIncident = incidentId
    ? incidents.find(i => i.id === incidentId)
    : null

  const [fields,    setFields]    = useState(EMPTY_FORM)
  const [errors,    setErrors]    = useState({})
  const [touched,   setTouched]   = useState({})
  const [saving,    setSaving]    = useState(false)
  const [saveError, setSaveError] = useState(null)

  // Populate form when editing
  useEffect(() => {
    if (mode === 'edit' && existingIncident) {
      setFields({
        incidentCode: existingIncident.incidentCode,
        rideId:       existingIncident.rideId,
        driverName:   existingIncident.driverName,
        vehicleId:    existingIncident.vehicleId,
        incidentType: existingIncident.incidentType,
        severity:     existingIncident.severity,
        description:  existingIncident.description,
        location:     existingIncident.location,
        status:       existingIncident.status,
      })
    } else if (mode === 'create') {
      setFields({ ...EMPTY_FORM, incidentCode: generateCode() })
    }
  }, [mode, incidentId])

  const handleChange = (e) => {
    const { name, value } = e.target
    setFields(prev => ({ ...prev, [name]: value }))
    setTouched(prev => ({ ...prev, [name]: true }))
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: undefined }))
    if (saveError)    setSaveError(null)
  }

  const handleBlur = (e) => {
    const { name } = e.target
    setTouched(prev => ({ ...prev, [name]: true }))
    const errs = validate(fields)
    if (errs[name]) setErrors(prev => ({ ...prev, [name]: errs[name] }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const errs = validate(fields)
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      setTouched(Object.fromEntries(Object.keys(EMPTY_FORM).map(k => [k, true])))
      return
    }

    setSaving(true)
    setSaveError(null)

    try {
      if (mode === 'create') {
        // createIncident writes to IndexedDB + sync_queue atomically
        await createIncident(fields)
      } else {
        // updateIncident writes to IndexedDB + sync_queue atomically
        await updateIncident(incidentId, fields)
      }
      setView('dashboard')
    } catch (err) {
      console.error('[IncidentForm] Save failed:', err)
      setSaveError(err.message || 'Failed to save incident. Check IndexedDB in DevTools.')
    } finally {
      setSaving(false)
    }
  }

  const fieldError = (name) =>
    touched[name] && errors[name]
      ? <p className="bb-field-error" role="alert">{errors[name]}</p>
      : null

  return (
    <div className="bb-form-page">
      {/* ── Page header ── */}
      <div className="bb-form-page__header">
        <button
          className="bb-btn bb-btn-ghost bb-btn-sm bb-back-btn"
          onClick={() => setView('dashboard')}
          aria-label="Back to dashboard"
        >
          ← Back
        </button>
        <h1 className="bb-form-page__title">
          {mode === 'create' ? 'New Incident' : `Edit ${existingIncident?.incidentCode ?? ''}`}
        </h1>
        {!isOnline && (
          <div className="bb-form-offline-notice" role="status">
            <span aria-hidden="true">◉</span> Offline — saved locally, will sync on reconnection
          </div>
        )}
      </div>

      <form
        className="bb-form"
        onSubmit={handleSubmit}
        noValidate
        aria-label={mode === 'create' ? 'Create incident form' : 'Edit incident form'}
      >
        {/* ── Save error ── */}
        {saveError && (
          <div className="bb-form-save-error" role="alert">
            <span aria-hidden="true">✗</span> {saveError}
          </div>
        )}

        {/* ════ INCIDENT ════ */}
        <div className="bb-form-section">
          <p className="bb-form-section__heading">Incident</p>
          <div className="bb-form__row">
            <div className="bb-field">
              <label className="bb-label" htmlFor="incidentCode">Incident Code</label>
              <input
                id="incidentCode" name="incidentCode"
                className={`bb-input mono ${errors.incidentCode && touched.incidentCode ? 'bb-input--error' : ''}`}
                value={fields.incidentCode} onChange={handleChange} onBlur={handleBlur}
                placeholder="INC-2026-00001"
                aria-invalid={!!(errors.incidentCode && touched.incidentCode)}
              />
              {fieldError('incidentCode')}
            </div>
            <div className="bb-field">
              <label className="bb-label" htmlFor="rideId">Ride ID</label>
              <input
                id="rideId" name="rideId"
                className={`bb-input mono ${errors.rideId && touched.rideId ? 'bb-input--error' : ''}`}
                value={fields.rideId} onChange={handleChange} onBlur={handleBlur}
                placeholder="RIDE-0000"
                aria-invalid={!!(errors.rideId && touched.rideId)}
              />
              {fieldError('rideId')}
            </div>
          </div>
          <div className="bb-form__row">
            <div className="bb-field">
              <label className="bb-label" htmlFor="incidentType">Incident Type</label>
              <select id="incidentType" name="incidentType" className="bb-select"
                value={fields.incidentType} onChange={handleChange}>
                {INCIDENT_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div className="bb-field">
              <label className="bb-label" htmlFor="severity">Severity</label>
              <select id="severity" name="severity" className="bb-select"
                value={fields.severity} onChange={handleChange}>
                {SEVERITIES.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* ════ OPERATIONAL CONTEXT ════ */}
        <div className="bb-form-section">
          <p className="bb-form-section__heading">Operational Context</p>
          <div className="bb-form__row">
            <div className="bb-field">
              <label className="bb-label" htmlFor="driverName">Driver Name</label>
              <input
                id="driverName" name="driverName"
                className={`bb-input ${errors.driverName && touched.driverName ? 'bb-input--error' : ''}`}
                value={fields.driverName} onChange={handleChange} onBlur={handleBlur}
                placeholder="Full name"
                aria-invalid={!!(errors.driverName && touched.driverName)}
              />
              {fieldError('driverName')}
            </div>
            <div className="bb-field">
              <label className="bb-label" htmlFor="vehicleId">Vehicle ID</label>
              <input
                id="vehicleId" name="vehicleId"
                className={`bb-input mono ${errors.vehicleId && touched.vehicleId ? 'bb-input--error' : ''}`}
                value={fields.vehicleId} onChange={handleChange} onBlur={handleBlur}
                placeholder="KXX 000X"
                aria-invalid={!!(errors.vehicleId && touched.vehicleId)}
              />
              {fieldError('vehicleId')}
            </div>
          </div>
          <div className="bb-field">
            <label className="bb-label" htmlFor="location">Location</label>
            <input
              id="location" name="location"
              className={`bb-input ${errors.location && touched.location ? 'bb-input--error' : ''}`}
              value={fields.location} onChange={handleChange} onBlur={handleBlur}
              placeholder="Street, area, city"
              aria-invalid={!!(errors.location && touched.location)}
            />
            {fieldError('location')}
          </div>
        </div>

        {/* ════ REPORT ════ */}
        <div className="bb-form-section">
          <p className="bb-form-section__heading">Report</p>
          <div className="bb-field">
            <label className="bb-label" htmlFor="description">Description</label>
            <textarea
              id="description" name="description"
              className={`bb-textarea ${errors.description && touched.description ? 'bb-input--error' : ''}`}
              value={fields.description} onChange={handleChange} onBlur={handleBlur}
              placeholder="Describe what happened — injuries, vehicle damage, actions taken, passenger state…"
              rows={4}
              aria-invalid={!!(errors.description && touched.description)}
            />
            {fieldError('description')}
          </div>
        </div>

        {/* ════ STATUS (edit only) ════ */}
        {mode === 'edit' && (
          <div className="bb-form-section">
            <p className="bb-form-section__heading">Status</p>
            <div className="bb-field">
              <label className="bb-label" htmlFor="status">Incident Status</label>
              <select id="status" name="status" className="bb-select"
                value={fields.status} onChange={handleChange}>
                {STATUSES.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* ── Form actions ── */}
        <div className="bb-form__actions">
          <button type="button" className="bb-btn bb-btn-ghost"
            onClick={() => setView('dashboard')}>
            Cancel
          </button>
          <button type="submit" className="bb-btn bb-btn-primary"
            disabled={saving} aria-busy={saving}>
            {saving
              ? 'Saving…'
              : mode === 'create' ? 'Create Incident' : 'Save Changes'}
          </button>
        </div>

        {!isOnline && (
          <p className="bb-form__offline-note">
            ◎ Changes saved locally — will sync when connection returns
          </p>
        )}
      </form>
    </div>
  )
}

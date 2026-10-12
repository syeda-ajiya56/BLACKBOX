// BLACKBOX — Incident controller
// All business logic lives here; routes are pure routing.
//
// VERSION CONFLICT RULE:
//   PUT /api/incidents/:id checks client version against server version.
//   client version must equal server version to be accepted.
//   If client version < server version → 409 VERSION_CONFLICT.
//   Resolution (LWW) is NOT performed here — that is Phase 2E.

const Incident = require('../models/Incident')

// ─────────────────────────────────────────────────────────────
// VALIDATION HELPERS
// ─────────────────────────────────────────────────────────────
const REQUIRED_ON_CREATE = [
  'id', 'incidentCode', 'rideId', 'driverName', 'vehicleId',
  'incidentType', 'severity', 'description', 'location',
  'createdAt', 'updatedAt', 'deviceId',
]

const VALID_TYPES     = ['collision','passenger_dispute','breakdown','theft','medical','route_deviation','other']
const VALID_SEVERITIES = ['low','medium','high','critical']
const VALID_STATUSES  = ['open','under_review','resolved','closed']

function validateCreate(body) {
  const errors = []
  for (const field of REQUIRED_ON_CREATE) {
    if (!body[field] && body[field] !== 0) errors.push(`${field} is required`)
  }
  if (body.incidentType && !VALID_TYPES.includes(body.incidentType))
    errors.push(`incidentType must be one of: ${VALID_TYPES.join(', ')}`)
  if (body.severity && !VALID_SEVERITIES.includes(body.severity))
    errors.push(`severity must be one of: ${VALID_SEVERITIES.join(', ')}`)
  if (body.status && !VALID_STATUSES.includes(body.status))
    errors.push(`status must be one of: ${VALID_STATUSES.join(', ')}`)
  return errors
}

function validateUpdate(body) {
  const errors = []
  if (body.version === undefined || body.version === null)
    errors.push('version is required for updates')
  if (typeof body.version !== 'number' || body.version < 1)
    errors.push('version must be a positive integer')
  if (!body.deviceId) errors.push('deviceId is required')
  if (body.incidentType && !VALID_TYPES.includes(body.incidentType))
    errors.push(`incidentType must be one of: ${VALID_TYPES.join(', ')}`)
  if (body.severity && !VALID_SEVERITIES.includes(body.severity))
    errors.push(`severity must be one of: ${VALID_SEVERITIES.join(', ')}`)
  if (body.status && !VALID_STATUSES.includes(body.status))
    errors.push(`status must be one of: ${VALID_STATUSES.join(', ')}`)
  return errors
}

// ─────────────────────────────────────────────────────────────
// GET /api/incidents
// Optional query param: ?since=<ISO8601>
// Used by the client pull/reconciliation step.
// Returns records updated after the given timestamp.
// ─────────────────────────────────────────────────────────────
exports.listIncidents = async (req, res, next) => {
  try {
    const { since } = req.query
    const filter = {}
    if (since) {
      // updatedAt is stored as an ISO8601 string — simple string comparison
      // works correctly for ISO dates with the same timezone offset.
      filter.updatedAt = { $gt: since }
    }

    const incidents = await Incident.find(filter).lean()

    // lean() returns plain objects; toJSON transform does not run —
    // strip _id manually.
    const sanitised = incidents.map(({ _id, __v, ...rest }) => rest)

    res.json({ success: true, incidents: sanitised })
  } catch (err) {
    next(err)
  }
}

// ─────────────────────────────────────────────────────────────
// GET /api/incidents/:id
// Returns the server's authoritative record.
// ─────────────────────────────────────────────────────────────
exports.getIncident = async (req, res, next) => {
  try {
    const incident = await Incident.findOne({ id: req.params.id }).lean()
    if (!incident) {
      return res.status(404).json({ success: false, error: 'Incident not found' })
    }
    const { _id, __v, ...rest } = incident
    res.json({ success: true, incident: rest })
  } catch (err) {
    next(err)
  }
}

// ─────────────────────────────────────────────────────────────
// POST /api/incidents
// Creates a new incident record.
// Idempotent: if the record already exists (same id), returns
// the existing record with a 200 rather than throwing a duplicate error.
// This handles the case where the client retries a successful POST
// that it did not receive a response for.
// ─────────────────────────────────────────────────────────────
exports.createIncident = async (req, res, next) => {
  try {
    const body = req.body

    // Validate required fields
    const errors = validateCreate(body)
    if (errors.length > 0) {
      return res.status(400).json({ success: false, error: 'Validation failed', details: errors })
    }

    // Idempotency check
    const existing = await Incident.findOne({ id: body.id }).lean()
    if (existing) {
      console.log(`[API] CREATE idempotent hit — incident ${body.id} already exists`)
      const { _id, __v, ...rest } = existing
      return res.status(200).json({ success: true, incident: rest, idempotent: true })
    }

    // Build the server record — server assigns version = 1
    const incident = new Incident({
      id:           body.id,
      incidentCode: body.incidentCode,
      rideId:       body.rideId,
      driverName:   body.driverName,
      vehicleId:    body.vehicleId,
      incidentType: body.incidentType,
      severity:     body.severity,
      description:  body.description,
      location:     body.location,
      status:       body.status || 'open',
      createdAt:    body.createdAt,
      updatedAt:    body.updatedAt,
      version:      1,                 // server sets version on creation
      deviceId:     body.deviceId,
    })

    await incident.save()
    console.log(`[API] Created incident: ${incident.id} (${incident.incidentCode})`)

    const { _id, __v, ...rest } = incident.toObject()
    res.status(201).json({ success: true, incident: rest })
  } catch (err) {
    // Mongoose duplicate key — can race the idempotency check above
    if (err.code === 11000) {
      const existing = await Incident.findOne({ id: req.body.id }).lean()
      if (existing) {
        const { _id, __v, ...rest } = existing
        return res.status(200).json({ success: true, incident: rest, idempotent: true })
      }
    }
    next(err)
  }
}

// ─────────────────────────────────────────────────────────────
// PUT /api/incidents/:id
// Updates an existing incident.
//
// VERSION CHECKING:
//   Client must supply its last-known server version.
//   If client.version === server.version → accept, increment server version.
//   If client.version !== server.version → 409 VERSION_CONFLICT.
//   (Less than OR greater than — both are conflicts in this scheme.)
// ─────────────────────────────────────────────────────────────
exports.updateIncident = async (req, res, next) => {
  try {
    const { id } = req.params
    const body    = req.body

    // Validate
    const errors = validateUpdate(body)
    if (errors.length > 0) {
      return res.status(400).json({ success: false, error: 'Validation failed', details: errors })
    }

    const serverRecord = await Incident.findOne({ id }).lean()
    if (!serverRecord) {
      return res.status(404).json({ success: false, error: 'Incident not found' })
    }

    const clientVersion = Number(body.version)
    const serverVersion = serverRecord.version

    // ── Version conflict ──────────────────────────────────
    if (clientVersion !== serverVersion) {
      console.log(`[API] VERSION_CONFLICT incident=${id} client=${clientVersion} server=${serverVersion}`)
      const { _id, __v, ...serverSnap } = serverRecord
      return res.status(409).json({
        success:         false,
        error:           'VERSION_CONFLICT',
        message:         `Client version ${clientVersion} does not match server version ${serverVersion}`,
        serverIncident:  serverSnap,
        clientVersion,
        serverVersion,
      })
    }

    // ── Accepted — apply update, increment version ────────
    const now = new Date().toISOString()

    // Build the update object from allowed writable fields.
    // Protect id, createdAt from being overwritten.
    const updateFields = {
      version:      serverVersion + 1,   // server increments
      updatedAt:    body.updatedAt || now,
    }

    const WRITABLE = ['incidentCode','rideId','driverName','vehicleId','incidentType',
                      'severity','description','location','status','deviceId']
    for (const field of WRITABLE) {
      if (body[field] !== undefined) updateFields[field] = body[field]
    }

    const updated = await Incident.findOneAndUpdate(
      { id },
      { $set: updateFields },
      { new: true, lean: true }
    )

    console.log(`[API] Updated incident: ${id} → v${updated.version}`)
    const { _id, __v, ...rest } = updated
    res.json({ success: true, incident: rest })
  } catch (err) {
    next(err)
  }
}

// ─────────────────────────────────────────────────────────────
// DELETE /api/incidents/:id
// Soft-delete: sets status = 'closed', increments version.
// Physical deletion is not performed — required for sync audit trail.
// ─────────────────────────────────────────────────────────────
exports.deleteIncident = async (req, res, next) => {
  try {
    const { id } = req.params
    const body    = req.body || {}

    const serverRecord = await Incident.findOne({ id }).lean()
    if (!serverRecord) {
      return res.status(404).json({ success: false, error: 'Incident not found' })
    }

    // Apply version check on soft-delete too — treat same as PUT
    if (body.version !== undefined && Number(body.version) !== serverRecord.version) {
      const { _id, __v, ...serverSnap } = serverRecord
      return res.status(409).json({
        success:        false,
        error:          'VERSION_CONFLICT',
        serverIncident: serverSnap,
        clientVersion:  Number(body.version),
        serverVersion:  serverRecord.version,
      })
    }

    const updated = await Incident.findOneAndUpdate(
      { id },
      { $set: { status: 'closed', version: serverRecord.version + 1, updatedAt: new Date().toISOString() } },
      { new: true, lean: true }
    )

    console.log(`[API] Soft-deleted incident: ${id} → v${updated.version}`)
    const { _id, __v, ...rest } = updated
    res.json({ success: true, incident: rest })
  } catch (err) {
    next(err)
  }
}

// ─────────────────────────────────────────────────────────────
// POST /api/incidents/:id/resolve
//
// Conflict resolution endpoint.
// Called by the sync engine ONLY after a 409 conflict has been
// resolved locally using LWW (Last-Write-Wins).
//
// DESIGN:
//   The client submits the winning record with { resolutionToken: true }.
//   The server does NOT apply a version equality check here — the
//   conflict was already detected (409), and the client's resolver
//   has chosen a winner deterministically.
//   The server still assigns the NEXT authoritative version number,
//   so version integrity is preserved without allowing arbitrary
//   client-chosen versions to corrupt the sequence.
//
// ANTI-LOOP PROTECTION:
//   This endpoint requires { resolutionToken: true } in the body.
//   Without it, the request is rejected with 400.
//   The sync engine NEVER sends resolutionToken on normal updates —
//   only on the specific POST after a 409 resolution.
//
// RESULT:
//   Server record updated to the resolved fields.
//   Server version incremented from whatever the current value is.
//   Authoritative record returned to client.
// ─────────────────────────────────────────────────────────────
exports.resolveIncident = async (req, res, next) => {
  try {
    const { id } = req.params
    const body    = req.body

    // Require the resolution token to prevent accidental mis-use
    if (!body.resolutionToken) {
      return res.status(400).json({
        success: false,
        error:   'resolutionToken required for conflict resolution endpoint',
      })
    }

    // Validate required data fields
    if (!body.deviceId) {
      return res.status(400).json({ success: false, error: 'deviceId is required' })
    }

    const serverRecord = await Incident.findOne({ id }).lean()
    if (!serverRecord) {
      return res.status(404).json({ success: false, error: 'Incident not found' })
    }

    // Build update — server sets next authoritative version
    const nextVersion = serverRecord.version + 1

    const WRITABLE = ['incidentCode','rideId','driverName','vehicleId','incidentType',
                      'severity','description','location','status','deviceId','updatedAt']
    const updateFields = { version: nextVersion }

    for (const field of WRITABLE) {
      if (body[field] !== undefined) updateFields[field] = body[field]
    }

    const updated = await Incident.findOneAndUpdate(
      { id },
      { $set: updateFields },
      { new: true, lean: true }
    )

    console.log(`[API] RESOLVED conflict: ${id} → v${updated.version} (winner: ${body.winner ?? 'unknown'})`)

    const { _id, __v, ...rest } = updated
    res.json({ success: true, incident: rest, resolved: true })
  } catch (err) {
    next(err)
  }
}

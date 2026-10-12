// BLACKBOX — Mongoose Incident model
// The 'id' field is the client-generated UUID (primary key for sync).
// MongoDB's _id is kept but never exposed to the client.
//
// VERSION AUTHORITY:
//   version is server-authoritative after the first sync.
//   On creation the server assigns version = 1.
//   On every accepted update the server increments version.
//   The client must send its last-known server version on PUT requests.
//   If client version != server version → 409 VERSION_CONFLICT.

const mongoose = require('mongoose')

const IncidentSchema = new mongoose.Schema(
  {
    // ── Client-assigned identity ──────────────────────────
    id: {
      type:     String,
      required: true,
      unique:   true,
      index:    true,
    },

    // ── Incident data fields ──────────────────────────────
    incidentCode: { type: String, required: true, trim: true },
    rideId:       { type: String, required: true, trim: true },
    driverName:   { type: String, required: true, trim: true },
    vehicleId:    { type: String, required: true, trim: true },

    incidentType: {
      type:     String,
      required: true,
      enum:     ['collision', 'passenger_dispute', 'breakdown', 'theft', 'medical', 'route_deviation', 'other'],
    },

    severity: {
      type:     String,
      required: true,
      enum:     ['low', 'medium', 'high', 'critical'],
    },

    description: { type: String, required: true, trim: true },
    location:    { type: String, required: true, trim: true },

    status: {
      type:    String,
      enum:    ['open', 'under_review', 'resolved', 'closed'],
      default: 'open',
    },

    // ── Timestamps (ISO8601, client-set) ──────────────────
    // We store what the client sends; the server does not
    // override these with server time.  Clock-skew is a
    // documented limitation (see architecture.md).
    createdAt: { type: String, required: true },
    updatedAt: { type: String, required: true },

    // ── Server-authoritative versioning ──────────────────
    version:  { type: Number, required: true, default: 1, min: 1 },

    // ── Device identity ───────────────────────────────────
    deviceId: { type: String, required: true, trim: true },
  },
  {
    // Keep MongoDB _id separate from client id — never send _id to client.
    _id: true,
    // Disable Mongoose automatic timestamps; we manage them client-side.
    timestamps: false,
  }
)

// Useful query indexes
IncidentSchema.index({ status: 1 })
IncidentSchema.index({ updatedAt: 1 })
IncidentSchema.index({ deviceId: 1 })

// Serialize to plain object for API responses:
// strips _id and __v, renames nothing.
IncidentSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret._id
    delete ret.__v
    return ret
  },
})

module.exports = mongoose.model('Incident', IncidentSchema)

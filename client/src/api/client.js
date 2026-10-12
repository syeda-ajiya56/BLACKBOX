// BLACKBOX — API client
// Centralised fetch wrapper for all server communication.
//
// ALL network calls go through apiRequest() or the named helpers below.
// No fetch() calls appear in React components or in syncEngine directly.
//
// BASE URL STRATEGY:
//   Development (npm run dev):  Vite proxies /api → http://localhost:5000
//   Production preview:         /api is served by the Express server directly
//   Either way the client always calls a relative /api/... path.

const BASE = '/api'

// Maximum ms to wait for a response before treating it as a network failure.
const TIMEOUT_MS = 15_000

// ─────────────────────────────────────────────────────────────
// Core request helper
// ─────────────────────────────────────────────────────────────

/**
 * apiRequest(method, path, body?)
 *
 * Returns a structured result object — never throws to callers.
 *
 * Success:  { ok: true,  data: <parsed JSON>,    status: 200 }
 * API error:{ ok: false, error: <string>,         status: 4xx/5xx, data: <body> }
 * Conflict: { ok: false, conflict: true,          status: 409, serverIncident, clientVersion, serverVersion }
 * Network:  { ok: false, networkError: true,      error: <string> }
 * Offline:  { ok: false, offline: true,           error: 'Device is offline' }
 */
export async function apiRequest(method, path, body = undefined) {
  // Fast-exit if we already know we are offline
  if (!navigator.onLine) {
    return { ok: false, offline: true, error: 'Device is offline' }
  }

  const url        = `${BASE}${path}`
  const controller = new AbortController()
  const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-BLACKBOX-Client': '1',
      },
      body:   body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })

    clearTimeout(timer)

    // Try to parse JSON regardless of status code
    let data
    try {
      data = await response.json()
    } catch {
      data = null
    }

    // ── 409 Version conflict ──────────────────────────────
    if (response.status === 409) {
      return {
        ok:              false,
        conflict:        true,
        status:          409,
        error:           data?.error || 'VERSION_CONFLICT',
        serverIncident:  data?.serverIncident  ?? null,
        clientVersion:   data?.clientVersion   ?? null,
        serverVersion:   data?.serverVersion   ?? null,
        data,
      }
    }

    // ── Other non-2xx ─────────────────────────────────────
    if (!response.ok) {
      return {
        ok:     false,
        status: response.status,
        error:  data?.error || `HTTP ${response.status}`,
        data,
      }
    }

    return { ok: true, status: response.status, data }

  } catch (err) {
    clearTimeout(timer)

    if (err.name === 'AbortError') {
      return { ok: false, networkError: true, error: 'Request timed out' }
    }

    // TypeError: Failed to fetch — classic offline / server-down symptom
    return { ok: false, networkError: true, error: err.message || 'Network error' }
  }
}

// ─────────────────────────────────────────────────────────────
// Named API helpers
// Called exclusively by syncEngine.js — not by React components.
// ─────────────────────────────────────────────────────────────

/**
 * checkHealth()
 * Tests whether the API server is reachable.
 * Used by the UI to show a server-reachable indicator.
 */
export async function checkHealth() {
  return apiRequest('GET', '/health')
}

/**
 * createIncidentOnServer(incident)
 * POST /api/incidents
 * Returns { ok, data: { incident } } or error shape.
 */
export async function createIncidentOnServer(incident) {
  return apiRequest('POST', '/incidents', incident)
}

/**
 * updateIncidentOnServer(id, payload)
 * PUT /api/incidents/:id
 * payload must include { version, ...changes }
 * Returns { ok, data: { incident } }, { conflict: true, serverIncident } or error shape.
 */
export async function updateIncidentOnServer(id, payload) {
  return apiRequest('PUT', `/incidents/${id}`, payload)
}

/**
 * deleteIncidentOnServer(id, version)
 * DELETE /api/incidents/:id
 * Sends client version for conflict checking.
 */
export async function deleteIncidentOnServer(id, version) {
  return apiRequest('DELETE', `/incidents/${id}`, { version })
}

/**
 * getIncidentFromServer(id)
 * GET /api/incidents/:id
 * Used by pull/reconciliation after conflict resolution.
 */
export async function getIncidentFromServer(id) {
  return apiRequest('GET', `/incidents/${id}`)
}

/**
 * getIncidentsFromServer(since?)
 * GET /api/incidents[?since=<ISO8601>]
 * Pull all (or recently updated) incidents for reconciliation.
 */
export async function getIncidentsFromServer(since = null) {
  const path = since ? `/incidents?since=${encodeURIComponent(since)}` : '/incidents'
  return apiRequest('GET', path)
}

/**
 * resolveIncidentOnServer(id, resolvedRecord, winner)
 * POST /api/incidents/:id/resolve
 *
 * Called ONLY after a 409 conflict has been resolved locally by LWW.
 * Sends the winning record with resolutionToken: true so the server
 * knows to bypass version equality and assign the next authoritative version.
 */
export async function resolveIncidentOnServer(id, resolvedRecord, winner) {
  return apiRequest('POST', `/incidents/${id}/resolve`, {
    ...resolvedRecord,
    resolutionToken: true,
    winner,           // informational — logged by server
  })
}

// BLACKBOX — Conflict Resolver
// ============================================================
// Pure deterministic function: NO database writes, NO API calls.
// Takes two incident snapshots and returns a structured decision.
//
// RULE: LAST-WRITE-WINS (LWW) on updatedAt
//
//   if local.updatedAt > server.updatedAt  → local wins
//   if local.updatedAt < server.updatedAt  → server wins
//   if equal                               → lexicographically greater deviceId wins
//
// KNOWN LIMITATION — CLOCK SKEW:
//   updatedAt is set by the client device clock.
//   If a device's clock is ahead of other devices, its records
//   will tend to win LWW comparisons regardless of actual edit order.
//   This is a documented, accepted limitation for this project scope.
//   Future mitigation: server-assigned timestamps or Hybrid Logical Clocks.
//
// SERVER VERSION AUTHORITY:
//   version is always assigned by the server. This function does NOT
//   assign a version number — the server does that after accepting
//   the winning record via POST /api/incidents/:id/resolve.
// ============================================================

export const CONFLICT_RULE = 'LWW_UPDATED_AT'

/**
 * resolveConflict(localRecord, serverRecord)
 *
 * Pure function — returns a decision object without side-effects.
 *
 * @param {object} localRecord  - Full incident snapshot from local IndexedDB
 * @param {object} serverRecord - Full incident snapshot from server 409 response
 * @returns {ConflictDecision}
 *
 * ConflictDecision shape:
 * {
 *   winner:         'local' | 'server'
 *   loser:          'server' | 'local'
 *   rule:           'LWW_UPDATED_AT'
 *   reason:         string   — human-readable explanation
 *   resolvedRecord: object   — the winning record's fields (no version assigned)
 *   localUpdatedAt: string
 *   serverUpdatedAt: string
 *   tieBreak:       boolean  — true if timestamps were equal, deviceId used
 * }
 */
export function resolveConflict(localRecord, serverRecord) {
  if (!localRecord || !serverRecord) {
    throw new Error('[conflictResolver] Both localRecord and serverRecord are required')
  }

  const localTs  = _parseTimestamp(localRecord.updatedAt)
  const serverTs = _parseTimestamp(serverRecord.updatedAt)

  let winner, loser, reason, tieBreak = false

  if (localTs > serverTs) {
    winner = 'local'
    loser  = 'server'
    reason = `Local record won: updatedAt ${_fmtTs(localRecord.updatedAt)} > ${_fmtTs(serverRecord.updatedAt)} (Last-Write-Wins)`
  } else if (serverTs > localTs) {
    winner = 'server'
    loser  = 'local'
    reason = `Server record won: updatedAt ${_fmtTs(serverRecord.updatedAt)} > ${_fmtTs(localRecord.updatedAt)} (Last-Write-Wins)`
  } else {
    // Equal timestamps — deterministic tie-break on deviceId (lexicographic)
    tieBreak = true
    const localDeviceId  = String(localRecord.deviceId  ?? '')
    const serverDeviceId = String(serverRecord.deviceId ?? '')

    if (localDeviceId >= serverDeviceId) {
      winner = 'local'
      loser  = 'server'
      reason = `Timestamps equal (${_fmtTs(localRecord.updatedAt)}); local deviceId "${localDeviceId}" ≥ server deviceId "${serverDeviceId}" — tie-break: local wins`
    } else {
      winner = 'server'
      loser  = 'local'
      reason = `Timestamps equal (${_fmtTs(localRecord.updatedAt)}); server deviceId "${serverDeviceId}" > local deviceId "${localDeviceId}" — tie-break: server wins`
    }
  }

  const resolvedRecord = winner === 'local' ? { ...localRecord } : { ...serverRecord }

  return {
    winner,
    loser,
    rule:            CONFLICT_RULE,
    reason,
    resolvedRecord,
    localUpdatedAt:  localRecord.updatedAt,
    serverUpdatedAt: serverRecord.updatedAt,
    tieBreak,
  }
}

// ─────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────

function _parseTimestamp(ts) {
  if (!ts) return 0
  const ms = new Date(ts).getTime()
  return isNaN(ms) ? 0 : ms
}

function _fmtTs(ts) {
  if (!ts) return '(missing)'
  try {
    return new Date(ts).toISOString().slice(11, 23) // HH:mm:ss.mmm
  } catch {
    return String(ts)
  }
}

// ============================================================
// UNIT TESTS
// Self-contained — run via: node src/sync/conflictResolver.js
// (No test framework required; logs PASS / FAIL to console.)
// ============================================================

export function runConflictResolverTests() {
  let passed = 0
  let failed = 0

  function assert(label, condition, detail = '') {
    if (condition) {
      console.log(`  [PASS] ${label}`)
      passed++
    } else {
      console.error(`  [FAIL] ${label}${detail ? ' — ' + detail : ''}`)
      failed++
    }
  }

  const base = {
    id: 'inc-test', incidentCode: 'TST-001', rideId: 'R1',
    driverName: 'Test Driver', vehicleId: 'V1',
    incidentType: 'collision', severity: 'medium',
    description: 'base', location: 'test', status: 'open',
    createdAt: '2026-10-03T10:00:00.000Z', version: 1,
  }

  // TC-R1: local updatedAt newer → local wins
  {
    const local  = { ...base, updatedAt: '2026-10-03T10:05:00.000Z', deviceId: 'aaa', description: 'local edit' }
    const server = { ...base, updatedAt: '2026-10-03T10:03:00.000Z', deviceId: 'bbb', description: 'server edit' }
    const d = resolveConflict(local, server)
    assert('TC-R1: local newer → local wins', d.winner === 'local', `got: ${d.winner}`)
    assert('TC-R1: resolvedRecord is local', d.resolvedRecord.description === 'local edit')
    assert('TC-R1: tieBreak is false', d.tieBreak === false)
  }

  // TC-R2: server updatedAt newer → server wins
  {
    const local  = { ...base, updatedAt: '2026-10-03T10:01:00.000Z', deviceId: 'aaa', description: 'local edit' }
    const server = { ...base, updatedAt: '2026-10-03T10:06:00.000Z', deviceId: 'bbb', description: 'server edit' }
    const d = resolveConflict(local, server)
    assert('TC-R2: server newer → server wins', d.winner === 'server', `got: ${d.winner}`)
    assert('TC-R2: resolvedRecord is server', d.resolvedRecord.description === 'server edit')
  }

  // TC-R3: equal timestamps, deviceId 'zzz' > 'aaa' → local (zzz) wins
  {
    const ts     = '2026-10-03T10:04:00.000Z'
    const local  = { ...base, updatedAt: ts, deviceId: 'zzz-device', description: 'local edit' }
    const server = { ...base, updatedAt: ts, deviceId: 'aaa-device', description: 'server edit' }
    const d = resolveConflict(local, server)
    assert('TC-R3: equal ts, local deviceId > server → local wins', d.winner === 'local', `got: ${d.winner}`)
    assert('TC-R3: tieBreak is true', d.tieBreak === true)
  }

  // TC-R4: equal timestamps, server deviceId 'zzz' > local 'aaa' → server wins
  {
    const ts     = '2026-10-03T10:04:00.000Z'
    const local  = { ...base, updatedAt: ts, deviceId: 'aaa-device', description: 'local edit' }
    const server = { ...base, updatedAt: ts, deviceId: 'zzz-device', description: 'server edit' }
    const d = resolveConflict(local, server)
    assert('TC-R4: equal ts, server deviceId > local → server wins', d.winner === 'server', `got: ${d.winner}`)
    assert('TC-R4: tieBreak is true', d.tieBreak === true)
  }

  // TC-R5: missing updatedAt on local → server wins
  {
    const local  = { ...base, updatedAt: null, deviceId: 'aaa' }
    const server = { ...base, updatedAt: '2026-10-03T10:02:00.000Z', deviceId: 'bbb' }
    const d = resolveConflict(local, server)
    assert('TC-R5: missing local ts → server wins', d.winner === 'server', `got: ${d.winner}`)
  }

  // TC-R6: both missing timestamps → deviceId tie-break
  {
    const local  = { ...base, updatedAt: null, deviceId: 'mmm' }
    const server = { ...base, updatedAt: null, deviceId: 'aaa' }
    const d = resolveConflict(local, server)
    assert('TC-R6: both missing ts → deviceId tie-break, local mmm > aaa', d.winner === 'local', `got: ${d.winner}`)
    assert('TC-R6: tieBreak is true', d.tieBreak === true)
  }

  // TC-R7: result is deterministic (same inputs → same output)
  {
    const local  = { ...base, updatedAt: '2026-10-03T10:05:00.000Z', deviceId: 'aaa' }
    const server = { ...base, updatedAt: '2026-10-03T10:03:00.000Z', deviceId: 'bbb' }
    const d1 = resolveConflict(local, server)
    const d2 = resolveConflict(local, server)
    assert('TC-R7: deterministic — same result on repeated call', d1.winner === d2.winner)
  }

  // TC-R8: resolvedRecord does not mutate inputs
  {
    const local  = { ...base, updatedAt: '2026-10-03T10:05:00.000Z', deviceId: 'aaa', description: 'original' }
    const server = { ...base, updatedAt: '2026-10-03T10:03:00.000Z', deviceId: 'bbb' }
    const d = resolveConflict(local, server)
    d.resolvedRecord.description = 'mutated'
    assert('TC-R8: input not mutated', local.description === 'original')
  }

  console.log(`\nConflictResolver tests: ${passed} passed, ${failed} failed`)
  return { passed, failed }
}

// Run tests when this module is executed directly
// (Works in Node.js via: node src/sync/conflictResolver.js)
if (typeof process !== 'undefined' && process.argv[1]?.includes('conflictResolver')) {
  console.log('Running conflictResolver unit tests...\n')
  const { failed } = runConflictResolverTests()
  process.exit(failed > 0 ? 1 : 0)
}

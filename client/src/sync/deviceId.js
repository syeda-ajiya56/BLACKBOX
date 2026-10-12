// BLACKBOX — Device identity
// Generates a UUID on first load and persists it in localStorage.
// Each browser (Chrome vs Incognito vs Firefox) gets its own deviceId —
// this is the mechanism for the two-browser conflict test.

import { v4 as uuidv4 } from 'uuid'

const STORAGE_KEY = 'blackbox_device_id'

export function getDeviceId() {
  let id = localStorage.getItem(STORAGE_KEY)
  if (!id) {
    id = uuidv4()
    localStorage.setItem(STORAGE_KEY, id)
    console.log('[BLACKBOX] New deviceId assigned:', id)
  }
  return id
}

export function initDeviceId() {
  return getDeviceId()
}

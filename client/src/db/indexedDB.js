// BLACKBOX — IndexedDB core
// Opens blackbox_db and manages schema upgrades.
//
// VERSION HISTORY
//   v1 — initial schema: incidents, sync_queue, conflict_log
//
// To add a new version: increment DB_VERSION and add a new `case` in
// the switch inside onupgradeneeded. Cases fall through from current → latest.

const DB_NAME    = 'blackbox_db'
const DB_VERSION = 1

/** Singleton promise — resolves to the open IDBDatabase instance. */
let _dbPromise = null

/**
 * openDB()
 * Returns a promise that resolves to the IDBDatabase.
 * Safe to call multiple times — returns the same promise after the first call.
 */
export function openDB() {
  if (_dbPromise) return _dbPromise

  _dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    // ── Schema creation / migration ──────────────────────────
    request.onupgradeneeded = (event) => {
      const db      = event.target.result
      const oldVer  = event.oldVersion   // 0 = brand new database

      // Fall-through switch so each version builds on the last.
      switch (true) {
        case oldVer < 1: {
          // ── incidents store ──────────────────────────────
          const incidentStore = db.createObjectStore('incidents', {
            keyPath: 'id',
          })
          incidentStore.createIndex('syncStatus', 'syncStatus', { unique: false })
          incidentStore.createIndex('updatedAt',  'updatedAt',  { unique: false })
          incidentStore.createIndex('status',     'status',     { unique: false })

          // ── sync_queue store ─────────────────────────────
          const queueStore = db.createObjectStore('sync_queue', {
            keyPath: 'queueId',
          })
          queueStore.createIndex('incidentId', 'incidentId', { unique: false })
          queueStore.createIndex('status',     'status',     { unique: false })
          queueStore.createIndex('timestamp',  'timestamp',  { unique: false })

          // ── conflict_log store (append-only) ─────────────
          const conflictStore = db.createObjectStore('conflict_log', {
            keyPath: 'conflictId',
          })
          conflictStore.createIndex('incidentId', 'incidentId', { unique: false })
          conflictStore.createIndex('detectedAt', 'detectedAt', { unique: false })

          console.log('[IDB] Schema v1 created: incidents, sync_queue, conflict_log')
          break
        }
        // case oldVer < 2: { /* future migration */ break }
      }
    }

    request.onsuccess = (event) => {
      const db = event.target.result

      // Surface unhandled IDB errors in the console
      db.onerror = (e) => {
        console.error('[IDB] Database error:', e.target.error)
      }

      console.log('[IDB] blackbox_db opened — version', db.version)
      resolve(db)
    }

    request.onerror = (event) => {
      const err = event.target.error
      console.error('[IDB] Failed to open blackbox_db:', err)
      _dbPromise = null   // allow retry
      reject(err)
    }

    request.onblocked = () => {
      console.warn('[IDB] Database upgrade blocked — close other tabs using BLACKBOX')
    }
  })

  return _dbPromise
}

/**
 * withStore(storeName, mode, callback)
 *
 * Opens a transaction on storeName with the given mode ('readonly' | 'readwrite'),
 * passes the IDBObjectStore to callback, and returns a Promise that resolves
 * when the transaction completes.
 *
 * Usage:
 *   const result = await withStore('incidents', 'readonly', store => store.get(id))
 */
export function withStore(storeName, mode, callback) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx    = db.transaction(storeName, mode)
        const store = tx.objectStore(storeName)

        let result

        try {
          const req = callback(store)

          if (req && typeof req.onsuccess !== 'undefined') {
            // It's an IDBRequest — wait for its result
            req.onsuccess = (e) => { result = e.target.result }
            req.onerror   = (e) => { reject(e.target.error) }
          } else {
            // callback returned a plain value or undefined
            result = req
          }
        } catch (err) {
          reject(err)
          return
        }

        tx.oncomplete = () => resolve(result)
        tx.onerror    = (e) => reject(e.target.error)
        tx.onabort    = (e) => reject(e.target.error ?? new Error('Transaction aborted'))
      })
  )
}

/**
 * withMultiStore(storeNames, mode, callback)
 *
 * Same as withStore but opens a transaction spanning multiple stores.
 * Required for atomic incident + sync_queue writes.
 *
 * Usage:
 *   await withMultiStore(['incidents','sync_queue'], 'readwrite', (incStore, qStore) => { ... })
 */
export function withMultiStore(storeNames, mode, callback) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeNames, mode)

        const stores = storeNames.map((name) => tx.objectStore(name))

        // Collect all pending IDBRequests from the callback
        const requests = []

        try {
          const returned = callback(...stores, (req) => {
            if (req && typeof req.onsuccess !== 'undefined') {
              requests.push(
                new Promise((res, rej) => {
                  req.onsuccess = (e) => res(e.target.result)
                  req.onerror   = (e) => rej(e.target.error)
                })
              )
            }
          })

          // If callback itself returns a value, use it; otherwise wait for tx
          if (returned !== undefined) {
            tx.oncomplete = () => resolve(returned)
          }
        } catch (err) {
          reject(err)
          return
        }

        tx.oncomplete = () => resolve()
        tx.onerror    = (e) => reject(e.target.error)
        tx.onabort    = (e) => reject(e.target.error ?? new Error('Transaction aborted'))
      })
  )
}

/**
 * getAll(storeName)
 * Convenience: returns all records from a store as an array.
 */
export function getAll(storeName) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx      = db.transaction(storeName, 'readonly')
        const store   = tx.objectStore(storeName)
        const request = store.getAll()

        request.onsuccess = (e) => resolve(e.target.result)
        request.onerror   = (e) => reject(e.target.error)
      })
  )
}

/**
 * getByIndex(storeName, indexName, value)
 * Returns all records matching an index value.
 */
export function getByIndex(storeName, indexName, value) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx      = db.transaction(storeName, 'readonly')
        const store   = tx.objectStore(storeName)
        const index   = store.index(indexName)
        const request = index.getAll(value)

        request.onsuccess = (e) => resolve(e.target.result)
        request.onerror   = (e) => reject(e.target.error)
      })
  )
}

/**
 * clearDB()
 * Dev helper — clears all stores. NOT called in production.
 */
export function clearDB() {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const storeNames = ['incidents', 'sync_queue', 'conflict_log']
        const tx = db.transaction(storeNames, 'readwrite')

        storeNames.forEach((name) => tx.objectStore(name).clear())

        tx.oncomplete = () => {
          console.log('[IDB] All stores cleared')
          resolve()
        }
        tx.onerror = (e) => reject(e.target.error)
      })
  )
}

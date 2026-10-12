// BLACKBOX — useOnlineStatus hook
// Wires window online/offline events to Zustand and to the sync engine.
// Also registers the SW message listener so TRIGGER_SYNC → flush().
// Call once from App.jsx.

import { useEffect } from 'react'
import useAppStore from '../store/appStore'
import { registerOnlineListener, registerSWMessageListener } from '../sync/syncEngine'

let _listenersRegistered = false   // guard against double-registration in StrictMode

export function useOnlineStatus() {
  const setOnline = useAppStore((s) => s.setOnline)

  useEffect(() => {
    // Sync the initial state in case the browser changed between renders
    setOnline(navigator.onLine)

    const handleOnline  = () => setOnline(true)
    const handleOffline = () => setOnline(false)

    window.addEventListener('online',  handleOnline)
    window.addEventListener('offline', handleOffline)

    // Register the sync engine listeners once
    if (!_listenersRegistered) {
      registerOnlineListener()       // window 'online' → flush()
      registerSWMessageListener()    // SW TRIGGER_SYNC → flush()
      _listenersRegistered = true
    }

    return () => {
      window.removeEventListener('online',  handleOnline)
      window.removeEventListener('offline', handleOffline)
      // Note: we deliberately do NOT remove the sync engine's own
      // online listener here — it should persist for the app lifetime.
    }
  }, [setOnline])
}

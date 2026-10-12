// BLACKBOX — Zustand global state store
import { create } from 'zustand'

const useAppStore = create((set) => ({
  // ── View routing ──────────────────────────────────────────
  activeView:         'dashboard',
  selectedIncidentId: null,
  setView: (view, incidentId = null) =>
    set({ activeView: view, selectedIncidentId: incidentId }),

  // ── Network status ────────────────────────────────────────
  isOnline: navigator.onLine,
  setOnline: (val) => set({ isOnline: val }),

  // ── Service Worker ────────────────────────────────────────
  swReady:    false,
  setSwReady: (val) => set({ swReady: val }),

  // ── Database loading ──────────────────────────────────────
  dbLoading:    true,
  dbError:      null,
  setDbLoading: (val) => set({ dbLoading: val }),
  setDbError:   (msg) => set({ dbError: msg }),

  // ── Sync state ────────────────────────────────────────────
  isSyncing:      false,
  lastSyncedAt:   null,
  pendingCount:   0,
  syncError:      null,   // string | null — last sync-engine error
  setSyncing:      (val) => set({ isSyncing: val }),
  setLastSyncedAt: (ts)  => set({ lastSyncedAt: ts }),
  setPendingCount: (n)   => set({ pendingCount: n }),
  setSyncError:    (msg) => set({ syncError: msg }),

  // ── Incidents ─────────────────────────────────────────────
  incidents:    [],
  setIncidents: (incidents) => set({ incidents }),

  // ── Sync queue ────────────────────────────────────────────
  syncQueue:    [],
  setSyncQueue: (q) => set({ syncQueue: q }),

  // ── Conflict log ──────────────────────────────────────────
  conflictLog:    [],
  setConflictLog: (log) => set({ conflictLog: log }),

  // Active (unacknowledged) conflict banners
  activeConflicts: [],
  addConflict: (c) =>
    set((s) => ({ activeConflicts: [...s.activeConflicts, c] })),
  dismissConflict: (conflictId) =>
    set((s) => ({
      activeConflicts: s.activeConflicts.filter(c => c.conflictId !== conflictId),
    })),

  // ── Mobile nav ────────────────────────────────────────────
  isMobileNavOpen:  false,
  setMobileNavOpen: (val) => set({ isMobileNavOpen: val }),
}))

export default useAppStore

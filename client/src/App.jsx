// BLACKBOX — Root Application Component
import React from 'react'
import AppShell from './components/layout/AppShell'
import IncidentDashboard from './components/incidents/IncidentDashboard'
import IncidentForm from './components/incidents/IncidentForm'
import IncidentDetail from './components/incidents/IncidentDetail'
import SyncQueuePanel from './components/sync/SyncQueuePanel'
import ConflictLog from './components/conflicts/ConflictLog'
import ConflictNotification from './components/conflicts/ConflictNotification'
import useAppStore from './store/appStore'
import { useIncidents } from './hooks/useIncidents'
import { useOnlineStatus } from './hooks/useOnlineStatus'
import { initDeviceId } from './sync/deviceId'

// Assign deviceId before anything renders
initDeviceId()

export default function App() {
  const { activeView, selectedIncidentId, activeConflicts, dismissConflict } = useAppStore()

  // Wire online/offline events and sync engine listeners
  useOnlineStatus()

  // Load all data from IndexedDB on mount
  useIncidents()

  const renderView = () => {
    switch (activeView) {
      case 'dashboard':       return <IncidentDashboard />
      case 'new-incident':    return <IncidentForm mode="create" />
      case 'edit-incident':   return <IncidentForm mode="edit" incidentId={selectedIncidentId} />
      case 'incident-detail': return <IncidentDetail incidentId={selectedIncidentId} />
      case 'sync-queue':      return <SyncQueuePanel />
      case 'conflict-log':    return <ConflictLog />
      default:                return <IncidentDashboard />
    }
  }

  return (
    <AppShell>
      {activeConflicts.map((c) => (
        <ConflictNotification
          key={c.conflictId}
          conflict={c}
          onAcknowledge={() => dismissConflict(c.conflictId)}
        />
      ))}
      {renderView()}
    </AppShell>
  )
}

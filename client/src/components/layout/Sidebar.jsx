// BLACKBOX — Sidebar / Navigation
// Mobile: slides in as a drawer from the left.
// Tablet/Desktop: permanently visible on the left side.
import React from 'react'
import useAppStore from '../../store/appStore'
import './Sidebar.css'

const NAV_ITEMS = [
  { id: 'dashboard',    label: 'Incidents',    icon: '◈', shortLabel: 'Board' },
  { id: 'sync-queue',   label: 'Sync Queue',   icon: '⟳', shortLabel: 'Sync' },
  { id: 'conflict-log', label: 'Conflict Log', icon: '⚡', shortLabel: 'Conflicts' },
]

export default function Sidebar() {
  const { activeView, setView, isMobileNavOpen, setMobileNavOpen, pendingCount } = useAppStore()

  const navigate = (viewId) => {
    setView(viewId)
    setMobileNavOpen(false)
  }

  return (
    <>
      {/* ── Desktop / Tablet persistent sidebar ── */}
      <nav
        className={`bb-sidebar ${isMobileNavOpen ? 'bb-sidebar--open' : ''}`}
        aria-label="Primary navigation"
      >
        <div className="bb-sidebar__section">
          <p className="bb-sidebar__section-label">Operations</p>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`bb-sidebar__item ${activeView === item.id || (activeView.startsWith('incident') && item.id === 'dashboard') ? 'active' : ''}`}
              onClick={() => navigate(item.id)}
              aria-current={activeView === item.id ? 'page' : undefined}
            >
              <span className="bb-sidebar__item-icon" aria-hidden="true">{item.icon}</span>
              <span className="bb-sidebar__item-label">{item.label}</span>
              {item.id === 'sync-queue' && pendingCount > 0 && (
                <span className="bb-sidebar__badge">{pendingCount}</span>
              )}
            </button>
          ))}
        </div>

        <div className="bb-sidebar__footer">
          <p className="bb-sidebar__version mono">
            <span className="bb-sidebar__status-dot" aria-hidden="true" />
            BLACKBOX v0.5.0
          </p>
        </div>
      </nav>

      {/* ── Mobile bottom tab bar ── */}
      <nav className="bb-bottom-nav" aria-label="Mobile navigation">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`bb-bottom-nav__item ${activeView === item.id || (activeView.startsWith('incident') && item.id === 'dashboard') ? 'active' : ''}`}
            onClick={() => navigate(item.id)}
            aria-label={item.label}
            aria-current={activeView === item.id ? 'page' : undefined}
          >
            <span className="bb-bottom-nav__icon" aria-hidden="true">{item.icon}</span>
            <span className="bb-bottom-nav__label">
              {item.shortLabel}
              {item.id === 'sync-queue' && pendingCount > 0 && (
                <span className="bb-bottom-nav__badge">{pendingCount}</span>
              )}
            </span>
          </button>
        ))}
      </nav>
    </>
  )
}

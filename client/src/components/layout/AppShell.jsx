// BLACKBOX — AppShell
// Mobile: top nav bar + bottom tab nav + full-height content area.
// Tablet/Desktop: persistent left sidebar + content area.
import React from 'react'
import StatusBar from './StatusBar'
import Sidebar from './Sidebar'
import useAppStore from '../../store/appStore'
import './AppShell.css'

export default function AppShell({ children }) {
  const { isMobileNavOpen, setMobileNavOpen } = useAppStore()

  return (
    <div className="bb-shell">
      {/* ── Top nav (mobile + tablet) ── */}
      <header className="bb-topnav" role="banner">
        <div className="bb-topnav__brand">
          <div className="bb-topnav__logo-wrap" aria-hidden="true">
            <span className="bb-topnav__logo">▣</span>
          </div>
          <div className="bb-topnav__text">
            <span className="bb-topnav__name">BLACKBOX</span>
            <span className="bb-topnav__tagline">Incident Intelligence</span>
          </div>
        </div>
        <StatusBar />
        {/* Hamburger — mobile only */}
        <button
          className="bb-topnav__hamburger"
          aria-label="Open navigation menu"
          aria-expanded={isMobileNavOpen}
          onClick={() => setMobileNavOpen(!isMobileNavOpen)}
        >
          <span className={`bb-hamburger-icon ${isMobileNavOpen ? 'open' : ''}`}>
            <span /><span /><span />
          </span>
        </button>
      </header>

      {/* ── Mobile drawer overlay ── */}
      {isMobileNavOpen && (
        <div
          className="bb-drawer-overlay"
          aria-hidden="true"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* ── Body: sidebar + content ── */}
      <div className="bb-body">
        <Sidebar />
        <main className="bb-main" role="main" id="main-content">
          <div className="bb-main__inner">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}

import { useState, useCallback, useMemo } from 'react'
import { View, Session } from './types'
import { mockProjects } from './mockData'
import { useTheme } from './hooks/useTheme'
import { useKeyboardNav } from './hooks/useKeyboardNav'
import { TopBar } from './components/TopBar'
import { NavRail } from './components/NavRail'
import { ContextPanel } from './components/ContextPanel'
import { Dashboard } from './views/Dashboard'
import { Sessions } from './views/Sessions'
import { Projects } from './views/Projects'
import { Settings } from './views/Settings'

export function App() {
  useTheme()

  const [activeView, setActiveView] = useState<View>('dashboard')
  const [focusIndex, setFocusIndex] = useState(0)
  const [panelOpen, setPanelOpen] = useState(false)

  const allSessions = useMemo(() => mockProjects.flatMap((p) => p.sessions), [])

  // Single source of truth: focusIndex drives both highlighted card and panel content
  const focusedSession = allSessions[focusIndex] ?? null
  const selectedSession = panelOpen ? focusedSession : null

  const handleViewChange = useCallback((view: View) => {
    setActiveView(view)
    setPanelOpen(false)
  }, [])

  const handleSessionClick = useCallback(
    (session: Session) => {
      const idx = allSessions.findIndex((s) => s.id === session.id)
      if (idx >= 0) setFocusIndex(idx)
      setPanelOpen(true)
    },
    [allSessions]
  )

  const handleClosePanel = useCallback(() => {
    setPanelOpen(false)
  }, [])

  useKeyboardNav({
    onViewChange: handleViewChange,
    onFocusNext: () => {
      setFocusIndex((i) => Math.min(i + 1, allSessions.length - 1))
    },
    onFocusPrev: () => {
      setFocusIndex((i) => Math.max(i - 1, 0))
    },
    onEscape: handleClosePanel,
    onEnter: () => setPanelOpen(true)
  })

  const focusedSessionId = focusedSession?.id ?? null

  return (
    <div className="app-layout">
      <TopBar sessions={allSessions} />
      <div className="app-body">
        <NavRail activeView={activeView} onViewChange={handleViewChange} />
        <div className="main-content">
          {activeView === 'dashboard' && (
            <Dashboard
              projects={mockProjects}
              focusedSessionId={focusedSessionId}
              onSessionClick={handleSessionClick}
            />
          )}
          {activeView === 'sessions' && (
            <Sessions projects={mockProjects} onSessionClick={handleSessionClick} />
          )}
          {activeView === 'projects' && <Projects projects={mockProjects} />}
          {activeView === 'settings' && <Settings />}
        </div>
        <ContextPanel session={selectedSession} onClose={handleClosePanel} />
      </div>
    </div>
  )
}

import { useState, useCallback, useMemo } from 'react'
import { View, Session } from './types'
import { useTheme } from './hooks/useTheme'
import { useKeyboardNav } from './hooks/useKeyboardNav'
import { useConfig } from './hooks/useConfig'
import { useSessionService } from './hooks/useSessionService'
import { TopBar } from './components/TopBar'
import { NavRail } from './components/NavRail'
import { ContextPanel } from './components/ContextPanel'
import { Dashboard } from './views/Dashboard'
import { Sessions } from './views/Sessions'
import { Projects } from './views/Projects'
import { Settings } from './views/Settings'

export function App() {
  useTheme()
  const { config, setConfig } = useConfig()
  const { projects, connectionStatus } = useSessionService(config)

  const [activeView, setActiveView] = useState<View>('dashboard')
  const [focusIndex, setFocusIndex] = useState(0)
  const [panelOpen, setPanelOpen] = useState(false)

  const allSessions = useMemo(() => projects.flatMap((p) => p.sessions), [projects])

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
      <TopBar sessions={allSessions} connectionStatus={connectionStatus} />
      <div className="app-body">
        <NavRail activeView={activeView} onViewChange={handleViewChange} />
        <div className="main-content">
          {activeView === 'dashboard' && (
            <Dashboard
              projects={projects}
              focusedSessionId={focusedSessionId}
              onSessionClick={handleSessionClick}
            />
          )}
          {activeView === 'sessions' && (
            <Sessions projects={projects} onSessionClick={handleSessionClick} />
          )}
          {activeView === 'projects' && <Projects projects={projects} />}
          {activeView === 'settings' && <Settings config={config} setConfig={setConfig} />}
        </div>
        <ContextPanel session={selectedSession} onClose={handleClosePanel} />
      </div>
    </div>
  )
}

import { useCallback, useMemo, useRef, useState } from 'react'
import { Session, View, isAttention } from './types'
import { useTheme } from './hooks/useTheme'
import { useKeyboardNav } from './hooks/useKeyboardNav'
import { useConfig } from './hooks/useConfig'
import { useSessionService } from './hooks/useSessionService'
import { TopBar } from './components/TopBar'
import { NavRail } from './components/NavRail'
import { ContextPanel } from './components/ContextPanel'
import { CmdKDispatch } from './components/CmdKDispatch'
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
  const [fullScreen, setFullScreen] = useState(false)
  const [cmdKOpen, setCmdKOpen] = useState(false)
  // Pre-selected project path for ⌘K (set by "+ New Session" button)
  const cmdKPresetPath = useRef<string | null>(null)

  // J/K nav order must match the visual order users see. Both Dashboard and
  // Sessions sort attention-first, then most recent activity. We mirror that
  // here as a flat list so keyboard nav lines up across views.
  const allSessions = useMemo(() => {
    const flat = projects.flatMap((p) => p.sessions)
    return [...flat].sort((a, b) => {
      const aAtt = isAttention(a.state)
      const bAtt = isAttention(b.state)
      if (aAtt && !bAtt) return -1
      if (!aAtt && bAtt) return 1
      return b.lastActivity - a.lastActivity
    })
  }, [projects])

  const focusedSession = allSessions[focusIndex] ?? null
  const selectedSession = panelOpen ? focusedSession : null
  const selectedProject = useMemo(
    () =>
      selectedSession
        ? projects.find((p) => p.sessions.some((s) => s.id === selectedSession.id)) ?? null
        : null,
    [projects, selectedSession]
  )

  const handleViewChange = useCallback((view: View) => {
    setActiveView(view)
    setPanelOpen(false)
    setFullScreen(false)
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
    setFullScreen(false)
  }, [])

  const handleToggleFullScreen = useCallback(() => {
    if (!panelOpen) {
      setPanelOpen(true)
      setFullScreen(true)
      return
    }
    setFullScreen((f) => !f)
  }, [panelOpen])

  const handleEscape = useCallback(() => {
    // Cascade: CmdK > fullScreen > panel > noop
    if (cmdKOpen) {
      setCmdKOpen(false)
      return
    }
    if (fullScreen) {
      setFullScreen(false)
      return
    }
    if (panelOpen) {
      setPanelOpen(false)
      return
    }
  }, [cmdKOpen, fullScreen, panelOpen])

  const focusedSessionId = focusedSession?.id ?? null

  const handleDispatched = useCallback(
    (sessionId: string) => {
      // Focus the newly created session once it shows up in a snapshot push.
      // Best-effort: if the id is already in allSessions, jump to it now.
      const idx = allSessions.findIndex((s) => s.id === sessionId)
      if (idx >= 0) {
        setFocusIndex(idx)
        setPanelOpen(true)
      }
    },
    [allSessions]
  )

  const handleNewSession = useCallback((projectPath: string) => {
    cmdKPresetPath.current = projectPath
    setCmdKOpen(true)
  }, [])

  const handleRefresh = useCallback(() => {
    const api = window.electronAPI?.opencode
    if (api) void api.getSnapshot()
  }, [])

  useKeyboardNav({
    onViewChange: handleViewChange,
    onFocusNext: () => {
      setFocusIndex((i) => Math.min(i + 1, allSessions.length - 1))
    },
    onFocusPrev: () => {
      setFocusIndex((i) => Math.max(i - 1, 0))
    },
    onEscape: handleEscape,
    onEnter: () => setPanelOpen(true),
    onToggleFullScreen: handleToggleFullScreen,
    onOpenCmdK: () => setCmdKOpen(true),
    onAttentionFilter: () => handleViewChange('sessions'),
    onRefresh: handleRefresh
  })

  return (
    <div className="app-layout">
      <TopBar
        sessions={allSessions}
        connectionStatus={connectionStatus}
        onCmdKClick={() => setCmdKOpen(true)}
      />
      <div className="app-body">
        {!fullScreen && <NavRail activeView={activeView} onViewChange={handleViewChange} />}
        {!fullScreen && (
          <div className="main-content">
            {activeView === 'dashboard' && (
              <Dashboard
                projects={projects}
                focusedSessionId={focusedSessionId}
                onSessionClick={handleSessionClick}
                onNewSession={handleNewSession}
              />
            )}
            {activeView === 'sessions' && (
              <Sessions projects={projects} onSessionClick={handleSessionClick} />
            )}
            {activeView === 'projects' && <Projects projects={projects} config={config} />}
            {activeView === 'settings' && <Settings config={config} setConfig={setConfig} />}
          </div>
        )}
        <ContextPanel
          session={selectedSession}
          project={selectedProject}
          config={config}
          fullScreen={fullScreen}
          onClose={handleClosePanel}
          onToggleFullScreen={handleToggleFullScreen}
        />
      </div>
      <CmdKDispatch
        open={cmdKOpen}
        projects={projects}
        config={config}
        onClose={() => {
          setCmdKOpen(false)
          cmdKPresetPath.current = null
        }}
        onDispatched={handleDispatched}
        presetProjectPath={cmdKPresetPath.current}
      />
    </div>
  )
}

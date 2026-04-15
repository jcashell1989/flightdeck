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
import { KanbanView } from './views/KanbanView'
import { Analytics } from './views/Analytics'
import { Settings } from './views/Settings'

export function App() {
  const { config, setConfig, configError, clearConfigError } = useConfig()
  useTheme(config?.theme)
  const { projects, connectionStatus } = useSessionService(config)

  const [activeView, setActiveView] = useState<View>('dashboard')
  const [focusIndex, setFocusIndex] = useState(0)
  const [panelOpen, setPanelOpen] = useState(false)
  const [fullScreen, setFullScreen] = useState(false)
  const [cmdKOpen, setCmdKOpen] = useState(false)
  const [attentionOnly, setAttentionOnly] = useState(false)
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

  // Shared destination for the 'A' keyboard shortcut and the top-bar ⚠ badge:
  // jump to the Sessions view with the attention filter active (spec-ux §1, §7).
  const handleAttentionJump = useCallback(() => {
    handleViewChange('sessions')
    setAttentionOnly(true)
  }, [handleViewChange])

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
    onAttentionFilter: handleAttentionJump,
    onRefresh: handleRefresh,
    isModalOpen: cmdKOpen
  })

  return (
    <div className="app-layout">
      <TopBar
        sessions={allSessions}
        connectionStatus={connectionStatus}
        onCmdKClick={() => setCmdKOpen(true)}
        onAttentionClick={handleAttentionJump}
      />
      <div className="app-body">
        {!fullScreen && <NavRail activeView={activeView} onViewChange={handleViewChange} />}
        {!fullScreen && (
          <div className="main-content">
            {configError && (
              <div
                role="alert"
                style={{
                  background: 'var(--status-error-bg, rgba(176,80,80,0.12))',
                  border: '1px solid var(--status-error, #b05050)',
                  color: 'var(--status-error, #b05050)',
                  borderRadius: 4,
                  padding: '8px 12px',
                  marginBottom: 12,
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12
                }}
              >
                <span>Config error: {configError}</span>
                <button
                  onClick={clearConfigError}
                  aria-label="Dismiss error"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'inherit',
                    cursor: 'pointer',
                    fontSize: 14,
                    padding: 0
                  }}
                >
                  ×
                </button>
              </div>
            )}
            {activeView === 'dashboard' && (
              <Dashboard
                projects={projects}
                focusedSessionId={focusedSessionId}
                onSessionClick={handleSessionClick}
                onNewSession={handleNewSession}
              />
            )}
            {activeView === 'sessions' && (
              <Sessions
                projects={projects}
                onSessionClick={handleSessionClick}
                attentionOnly={attentionOnly}
                setAttentionOnly={setAttentionOnly}
              />
            )}
            {activeView === 'projects' && <Projects projects={projects} config={config} />}
            {activeView === 'kanban' && <KanbanView />}
            {activeView === 'analytics' && <Analytics />}
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

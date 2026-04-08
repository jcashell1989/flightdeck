import { useState } from 'react'
import { Project, Session } from '../types'
import { SessionCard } from './SessionCard'

interface ProjectGroupProps {
  project: Project
  focusedSessionId: string | null
  onSessionClick: (session: Session) => void
  onNewSession?: (projectPath: string) => void
}

export function ProjectGroup({ project, focusedSessionId, onSessionClick, onNewSession }: ProjectGroupProps) {
  const [collapsed, setCollapsed] = useState(false)

  const activeCount = project.sessions.filter((s) => s.state === 'running' || s.state === 'approval' || s.state === 'question').length
  const attentionCount = project.sessions.filter((s) => s.state === 'approval' || s.state === 'question' || s.state === 'review').length

  const opencodeSessions = project.sessions.filter((s) => s.agentType === 'opencode')
  const claudeSessions = project.sessions.filter((s) => s.agentType === 'claude-code')

  return (
    <div style={{ marginBottom: 24 }}>
      {/* Project header */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        aria-label={`${project.name} project, ${collapsed ? 'collapsed' : 'expanded'}`}
        className="project-group-header"
        onClick={() => setCollapsed(!collapsed)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setCollapsed(!collapsed)
          }
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 0',
          cursor: 'pointer',
          userSelect: 'none'
        }}
      >
        <span style={{ fontSize: 12, color: 'var(--fg-subtle)', width: 14 }}>
          {collapsed ? '▶' : '▼'}
        </span>
        <span style={{ fontWeight: 500 }}>{project.name}</span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--fg-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {project.path}
        </span>
        <div style={{ flex: 1 }} />
        {attentionCount > 0 ? (
          <span style={{ fontSize: 11, color: 'var(--status-approval)', fontWeight: 500 }}>
            ⚠ {attentionCount} needs attention
          </span>
        ) : activeCount > 0 ? (
          <span style={{ fontSize: 11, color: 'var(--status-running)', fontWeight: 500 }}>
            ● {activeCount} active
          </span>
        ) : null}
        {onNewSession && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onNewSession(project.path)
            }}
            title="New session for this project"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--fg-subtle)',
              cursor: 'pointer',
              fontSize: 11,
              padding: '0 4px',
              opacity: 0,
              transition: 'opacity 0.15s'
            }}
            className="new-session-btn"
          >
            + New Session
          </button>
        )}
      </div>

      {!collapsed && (
        <div style={{ paddingLeft: 22 }}>
          {opencodeSessions.length > 0 && (
            <AgentSection label="opencode" sessions={opencodeSessions} focusedSessionId={focusedSessionId} onSessionClick={onSessionClick} />
          )}
          {claudeSessions.length > 0 && (
            <AgentSection label="claude-code" sessions={claudeSessions} focusedSessionId={focusedSessionId} onSessionClick={onSessionClick} />
          )}
        </div>
      )}
    </div>
  )
}

function AgentSection({
  label,
  sessions,
  focusedSessionId,
  onSessionClick
}: {
  label: string
  sessions: Session[]
  focusedSessionId: string | null
  onSessionClick: (session: Session) => void
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: 'var(--fg-subtle)', padding: '4px 0 8px', borderBottom: '1px solid var(--border)', marginBottom: 8 }}>
        └─ {label}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {sessions.map((session) => (
          <div key={session.id} style={{ flex: '1 1 280px', maxWidth: 480 }}>
            <SessionCard
              session={session}
              focused={focusedSessionId === session.id}
              onClick={() => onSessionClick(session)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

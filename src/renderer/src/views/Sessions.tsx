import { useMemo } from 'react'
import { Project, Session, SessionState, isAttention } from '../types'
import { StatusDot } from '../components/StatusDot'

interface SessionsProps {
  projects: Project[]
  onSessionClick: (session: Session) => void
}

const STATUS_LABELS: Record<SessionState, string> = {
  running: 'Running',
  idle: 'Idle',
  approval: 'Needs Approval',
  question: 'Has Question',
  review: 'Review Changes',
  error: 'Error'
}

export function Sessions({ projects, onSessionClick }: SessionsProps) {
  const allSessions = useMemo(() => {
    const flat = projects.flatMap((p) =>
      p.sessions.map((s) => ({ ...s, projectName: p.name }))
    )
    flat.sort((a, b) => {
      const aAtt = isAttention(a.state)
      const bAtt = isAttention(b.state)
      if (aAtt && !bAtt) return -1
      if (!aAtt && bAtt) return 1
      return b.lastActivity - a.lastActivity
    })
    return flat
  }, [projects])

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 500, marginBottom: 16 }}>Sessions</h2>
      <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--fg-subtle)', textAlign: 'left' }}>
            <th style={{ padding: '6px 8px', fontWeight: 500 }}>Status</th>
            <th style={{ padding: '6px 8px', fontWeight: 500 }}>Agent</th>
            <th style={{ padding: '6px 8px', fontWeight: 500 }}>ID</th>
            <th style={{ padding: '6px 8px', fontWeight: 500 }}>Project</th>
            <th style={{ padding: '6px 8px', fontWeight: 500 }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {allSessions.map((s) => (
            <tr
              key={s.id}
              role="button"
              tabIndex={0}
              aria-label={`${s.agentType} session ${s.id.slice(-4)}, ${STATUS_LABELS[s.state]}`}
              onClick={() => onSessionClick(s)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSessionClick(s)
                }
              }}
              style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
            >
              <td style={{ padding: '8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <StatusDot state={s.state} />
                <span style={{ color: `var(--status-${s.state})` }}>{STATUS_LABELS[s.state]}</span>
              </td>
              <td style={{ padding: '8px', color: 'var(--fg-muted)' }}>{s.agentType}</td>
              <td className="mono" style={{ padding: '8px', color: 'var(--fg-subtle)' }} title={s.id}>#{s.id.slice(-4)}</td>
              <td style={{ padding: '8px', color: 'var(--fg-muted)' }}>{s.projectName}</td>
              <td className="mono" style={{ padding: '8px', color: 'var(--fg-primary)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.currentAction}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  )
}

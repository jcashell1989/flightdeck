import { useMemo } from 'react'
import type { OpencodeSnapshotPayload, SessionState } from '@shared/types'
import { SessionCard } from '../components/SessionCard'

const ATTENTION_STATES = new Set<SessionState>(['approval', 'question', 'error'])

interface DashboardProps {
  snapshot: OpencodeSnapshotPayload
  onSelectSession: (projectId: string, sessionId: string) => void
}

export function Dashboard({ snapshot, onSelectSession }: DashboardProps) {
  const sorted = useMemo(() => {
    return [...snapshot.projects].sort((a, b) => {
      const aAttention = a.sessions.some((s) => ATTENTION_STATES.has(s.state))
      const bAttention = b.sessions.some((s) => ATTENTION_STATES.has(s.state))
      if (aAttention && !bAttention) return -1
      if (!aAttention && bAttention) return 1
      const aRecent = a.sessions.length === 0 ? 0 : Math.max(...a.sessions.map((s) => s.lastActivity))
      const bRecent = b.sessions.length === 0 ? 0 : Math.max(...b.sessions.map((s) => s.lastActivity))
      return bRecent - aRecent
    })
  }, [snapshot.projects])

  if (sorted.length === 0) {
    return (
      <div style={{ padding: '2rem', color: '#71717a', textAlign: 'center' }}>
        No projects. Open the desktop app to add projects and start sessions.
      </div>
    )
  }

  return (
    <div>
      {sorted.map((project) => {
        const sortedSessions = [...project.sessions].sort((a, b) => {
          const aAttn = ATTENTION_STATES.has(a.state)
          const bAttn = ATTENTION_STATES.has(b.state)
          if (aAttn && !bAttn) return -1
          if (!aAttn && bAttn) return 1
          return b.lastActivity - a.lastActivity
        })

        return (
          <div key={project.id} style={{ marginBottom: '1.5rem' }}>
            <div style={{
              fontSize: 13,
              fontWeight: 600,
              color: '#a1a1aa',
              padding: '0 0 0.5rem 0',
              borderBottom: '1px solid #27272a',
              marginBottom: '0.5rem',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {project.name}
            </div>
            {sortedSessions.length === 0 ? (
              <div style={{ fontSize: 12, color: '#52525b', padding: '0.25rem 0' }}>
                No active sessions
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {sortedSessions.map((session) => (
                  <SessionCard
                    key={session.id}
                    session={session}
                    projectName={project.name}
                    onClick={() => onSelectSession(project.id, session.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

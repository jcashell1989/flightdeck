import { useMemo } from 'react'
import { Project, Session, isAttention } from '../types'
import { ProjectGroup } from '../components/ProjectGroup'

interface DashboardProps {
  projects: Project[]
  focusedSessionId: string | null
  onSessionClick: (session: Session) => void
  onNewSession?: (projectPath: string) => void
}

export function Dashboard({ projects, focusedSessionId, onSessionClick, onNewSession }: DashboardProps) {
  // Sort: projects with attention-needed sessions float to top, then by most recent activity
  const sorted = useMemo(() => {
    return [...projects].sort((a, b) => {
      const aAttention = a.sessions.some((s) => isAttention(s.state))
      const bAttention = b.sessions.some((s) => isAttention(s.state))
      if (aAttention && !bAttention) return -1
      if (!aAttention && bAttention) return 1
      const aRecent = Math.max(...a.sessions.map((s) => s.lastActivity))
      const bRecent = Math.max(...b.sessions.map((s) => s.lastActivity))
      return bRecent - aRecent
    })
  }, [projects])

  return (
    <div>
      {sorted.map((project) => (
        <ProjectGroup
          key={project.id}
          project={project}
          focusedSessionId={focusedSessionId}
          onSessionClick={onSessionClick}
          onNewSession={onNewSession}
        />
      ))}
    </div>
  )
}

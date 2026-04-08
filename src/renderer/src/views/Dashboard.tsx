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
      // Math.max(...[]) is -Infinity — clamp to 0 so a project with no
      // sessions sorts to the bottom instead of producing NaN comparisons.
      const aRecent = a.sessions.length === 0 ? 0 : Math.max(...a.sessions.map((s) => s.lastActivity))
      const bRecent = b.sessions.length === 0 ? 0 : Math.max(...b.sessions.map((s) => s.lastActivity))
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

import { Project, Session } from '../types'
import { ProjectGroup } from '../components/ProjectGroup'

interface DashboardProps {
  projects: Project[]
  focusedSessionId: string | null
  onSessionClick: (session: Session) => void
}

export function Dashboard({ projects, focusedSessionId, onSessionClick }: DashboardProps) {
  // Sort: projects with attention-needed sessions float to top, then by most recent activity
  const sorted = [...projects].sort((a, b) => {
    const aAttention = a.sessions.some((s) => s.state === 'approval' || s.state === 'question' || s.state === 'review')
    const bAttention = b.sessions.some((s) => s.state === 'approval' || s.state === 'question' || s.state === 'review')
    if (aAttention && !bAttention) return -1
    if (!aAttention && bAttention) return 1
    const aRecent = Math.max(...a.sessions.map((s) => s.lastActivity))
    const bRecent = Math.max(...b.sessions.map((s) => s.lastActivity))
    return bRecent - aRecent
  })

  return (
    <div>
      {sorted.map((project) => (
        <ProjectGroup
          key={project.id}
          project={project}
          focusedSessionId={focusedSessionId}
          onSessionClick={onSessionClick}
        />
      ))}
    </div>
  )
}

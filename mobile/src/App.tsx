import { useState } from 'react'
import { useSnapshot } from './hooks/useSnapshot'
import { Dashboard } from './views/Dashboard'
import { SessionDetail } from './views/SessionDetail'
import './App.css'

type View =
  | { name: 'dashboard' }
  | { name: 'session'; projectId: string; sessionId: string }

export default function App() {
  const [view, setView] = useState<View>({ name: 'dashboard' })
  const { data: snapshot, error } = useSnapshot()

  if (error) return <div style={{ padding: '1rem', color: '#ef4444' }}>Connection error: {error}</div>
  if (!snapshot) return <div style={{ padding: '1rem', color: '#a1a1aa' }}>Connecting...</div>

  if (view.name === 'session') {
    const project = snapshot.projects.find(p => p.id === view.projectId)
    const session = project?.sessions.find(s => s.id === view.sessionId)
    if (!session) {
      return (
        <Dashboard
          snapshot={snapshot}
          onSelectSession={(pid, sid) => setView({ name: 'session', projectId: pid, sessionId: sid })}
        />
      )
    }
    return (
      <SessionDetail
        session={session}
        projectName={project?.name ?? view.projectId}
        onBack={() => setView({ name: 'dashboard' })}
      />
    )
  }

  return (
    <div>
      <header className="app-header">
        <span className="app-title">Flightdeck</span>
        <span className="connection-status" data-status={snapshot.aggregateStatus.status}>
          {snapshot.aggregateStatus.status}
        </span>
      </header>
      <main className="app-main">
        <Dashboard
          snapshot={snapshot}
          onSelectSession={(pid, sid) => setView({ name: 'session', projectId: pid, sessionId: sid })}
        />
      </main>
    </div>
  )
}

import { Project } from '../types'

interface ProjectsProps {
  projects: Project[]
}

export function Projects({ projects }: ProjectsProps) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 500 }}>Projects</h2>
        <button
          style={{
            padding: '6px 14px',
            fontSize: 12,
            fontWeight: 500,
            border: '1px solid var(--accent)',
            borderRadius: 6,
            background: 'transparent',
            color: 'var(--accent)',
            cursor: 'pointer'
          }}
        >
          + Add Project
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {projects.map((project) => {
          const activeCount = project.sessions.filter((s) => s.state === 'running').length
          return (
            <div
              key={project.id}
              style={{
                padding: '12px 16px',
                border: '1px solid var(--border)',
                borderRadius: 6,
                backgroundColor: 'var(--bg-panel)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                <span style={{ fontWeight: 500 }}>{project.name}</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--fg-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {project.path}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: 'var(--fg-subtle)' }}>
                {activeCount > 0 ? (
                  <span style={{ color: 'var(--status-running)' }}>● {activeCount} active sessions</span>
                ) : (
                  <span>{project.sessions.length} sessions</span>
                )}
                <span>opencode (default)</span>
                <div style={{ flex: 1 }} />
                <button
                  style={{
                    padding: '2px 8px',
                    fontSize: 11,
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    background: 'transparent',
                    color: 'var(--fg-subtle)',
                    cursor: 'pointer'
                  }}
                >
                  Archive
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

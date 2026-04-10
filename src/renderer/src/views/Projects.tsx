import { useCallback, useEffect, useRef, useState } from 'react'
import { AppConfig, Project, ProjectConfig } from '../types'

interface ProjectsProps {
  projects: Project[]
  config: AppConfig | null
}

// ── Undo toast ─────────────────────────────────────────────────────────────

interface ToastState {
  message: string
  onUndo: () => void
  timeoutId: ReturnType<typeof setTimeout>
}

// ── Add Project drawer ─────────────────────────────────────────────────────

interface ValidationResult {
  valid: boolean
  reason?: string
  isGitRepo?: boolean
}

function AddProjectDrawer({
  onClose,
  onAdded
}: {
  onClose: () => void
  onAdded: () => void
}) {
  const [path, setPath] = useState('')

  // Esc closes the drawer (mirrors the App-level escape handler but scoped to the drawer).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  const [displayName, setDisplayName] = useState('')
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [validating, setValidating] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const validate = useCallback((p: string) => {
    if (!p.trim()) {
      setValidation(null)
      return
    }
    setValidating(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      const api = window.electronAPI?.project
      if (!api) return
      const result = await api.validate(p.trim())
      setValidation(result)
      setValidating(false)
    }, 300)
  }, [])

  const handlePathChange = (value: string) => {
    setPath(value)
    // Auto-fill display name from last path segment.
    const parts = value.trim().split('/').filter(Boolean)
    if (parts.length > 0) setDisplayName(parts[parts.length - 1])
    validate(value)
  }

  const handleBrowse = async () => {
    const api = window.electronAPI?.project
    if (!api) return
    const selected = await api.browse()
    if (selected) {
      handlePathChange(selected)
    }
  }

  const handleSubmit = async () => {
    if (!validation?.valid || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const api = window.electronAPI?.project
      if (!api) throw new Error('bridge unavailable')
      await api.add({
        path: path.trim(),
        name: displayName.trim() || undefined,
        gitInit: validation.isGitRepo === false
      })
      onAdded()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  const validationColor =
    !validation ? 'var(--fg-subtle)' :
    !validation.valid ? 'var(--status-error)' :
    validation.isGitRepo === false ? 'var(--status-approval)' :
    'var(--status-running)'

  const validationText =
    validating ? 'Checking…' :
    !validation ? '' :
    !validation.valid ? `\u26a0 ${validation.reason ?? 'invalid path'}` :
    validation.isGitRepo === false ? '\u26a0 Not a git repo \u2014 will initialize' :
    '\u2713 Valid git repo'

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 360,
        backgroundColor: 'var(--bg-panel)',
        borderLeft: '1px solid var(--border)',
        boxShadow: '-8px 0 24px rgba(0,0,0,0.2)',
        padding: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        zIndex: 500,
        fontSize: 12
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>Add Project</span>
        <button
          onClick={onClose}
          aria-label="Close drawer"
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--fg-subtle)',
            cursor: 'pointer',
            fontSize: 16,
            padding: '4px 8px',
            minWidth: 32,
            minHeight: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 4
          }}
        >
          ×
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ color: 'var(--fg-muted)', fontWeight: 500 }}>Directory</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={path}
            onChange={(e) => handlePathChange(e.target.value)}
            placeholder="/Users/you/projects/my-app"
            style={{
              flex: 1,
              padding: '7px 10px',
              fontSize: 12,
              fontFamily: '"Berkeley Mono", "SF Mono", monospace',
              border: '1px solid var(--border)',
              borderRadius: 4,
              backgroundColor: 'var(--bg-base)',
              color: 'var(--fg-primary)',
              outline: 'none'
            }}
          />
          <button
            onClick={handleBrowse}
            style={{
              padding: '7px 10px',
              fontSize: 11,
              border: '1px solid var(--border)',
              borderRadius: 4,
              background: 'transparent',
              color: 'var(--fg-muted)',
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            Browse…
          </button>
        </div>
        {validationText && (
          <span style={{ fontSize: 11, color: validationColor }}>{validationText}</span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ color: 'var(--fg-muted)', fontWeight: 500 }}>Display Name (optional)</label>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="my-app"
          style={{
            padding: '7px 10px',
            fontSize: 12,
            border: '1px solid var(--border)',
            borderRadius: 4,
            backgroundColor: 'var(--bg-base)',
            color: 'var(--fg-primary)',
            outline: 'none'
          }}
        />
      </div>

      {error && (
        <div style={{ color: 'var(--status-error)', fontSize: 11 }}>{error}</div>
      )}

      <div style={{ flex: 1 }} />

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          onClick={onClose}
          style={{
            padding: '7px 14px',
            fontSize: 12,
            border: '1px solid var(--border)',
            borderRadius: 4,
            background: 'transparent',
            color: 'var(--fg-muted)',
            cursor: 'pointer'
          }}
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!validation?.valid || submitting}
          style={{
            padding: '7px 14px',
            fontSize: 12,
            fontWeight: 500,
            border: '1px solid var(--accent)',
            borderRadius: 4,
            background: 'transparent',
            color: validation?.valid ? 'var(--accent)' : 'var(--fg-subtle)',
            cursor: validation?.valid ? 'pointer' : 'not-allowed',
            opacity: validation?.valid ? 1 : 0.5
          }}
        >
          {submitting ? 'Adding…' : 'Add Project →'}
        </button>
      </div>
    </div>
  )
}

// ── Delete confirmation ────────────────────────────────────────────────────

function DeleteConfirm({
  project,
  onCancel,
  onDeleted
}: {
  project: ProjectConfig
  onCancel: () => void
  onDeleted: () => void
}) {
  const [input, setInput] = useState('')
  const [deleting, setDeleting] = useState(false)
  const name = project.name ?? project.path.split('/').filter(Boolean).pop() ?? project.path

  const matches = input.trim() === name.trim()

  const handleDelete = async () => {
    if (!matches || deleting) return
    setDeleting(true)
    try {
      await window.electronAPI?.project?.delete(project.path)
      onDeleted()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div
      style={{
        marginTop: 8,
        padding: '10px 12px',
        border: '1px solid var(--status-error)',
        borderRadius: 4,
        backgroundColor: 'var(--tint-error)',
        fontSize: 11
      }}
    >
      <div style={{ marginBottom: 8, color: 'var(--fg-primary)' }}>
        Type <strong>{name}</strong> to confirm deletion:
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={name}
          style={{
            flex: 1,
            padding: '4px 8px',
            fontSize: 11,
            border: '1px solid var(--border)',
            borderRadius: 4,
            backgroundColor: 'var(--bg-base)',
            color: 'var(--fg-primary)',
            outline: 'none'
          }}
        />
        <button
          onClick={handleDelete}
          disabled={!matches || deleting}
          style={{
            padding: '4px 10px',
            fontSize: 11,
            border: '1px solid var(--status-error)',
            borderRadius: 4,
            background: 'transparent',
            color: matches ? 'var(--status-error)' : 'var(--fg-subtle)',
            cursor: matches ? 'pointer' : 'not-allowed'
          }}
        >
          {deleting ? 'Deleting…' : 'Delete'}
        </button>
        <button
          onClick={onCancel}
          style={{
            padding: '4px 10px',
            fontSize: 11,
            border: '1px solid var(--border)',
            borderRadius: 4,
            background: 'transparent',
            color: 'var(--fg-muted)',
            cursor: 'pointer'
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Main Projects view ─────────────────────────────────────────────────────

export function Projects({ projects, config }: ProjectsProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [archivedExpanded, setArchivedExpanded] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  // Dismiss toast on unmount.
  useEffect(() => {
    return () => {
      if (toast) clearTimeout(toast.timeoutId)
    }
  }, [toast])

  const showUndoToast = useCallback((message: string, onUndo: () => void) => {
    if (toast) clearTimeout(toast.timeoutId)
    const timeoutId = setTimeout(() => setToast(null), 5000)
    setToast({ message, onUndo, timeoutId })
  }, [toast])

  const handleArchive = useCallback(async (project: ProjectConfig) => {
    const api = window.electronAPI?.project
    if (!api) return
    await api.archive(project.path)
    const name = project.name ?? project.path.split('/').filter(Boolean).pop() ?? project.path
    showUndoToast(`Archived "${name}"`, async () => {
      await api.restore(project.path)
      setToast(null)
    })
  }, [showUndoToast])

  const handleRestore = useCallback(async (path: string) => {
    await window.electronAPI?.project?.restore(path)
  }, [])

  // Build project rows from config, enriched with live session data.
  const configProjects = config?.projects ?? []
  const activeProjects = configProjects.filter((p) => !p.archived)
  const archivedProjects = configProjects.filter((p) => p.archived)

  const getLiveSessions = (path: string) =>
    projects.find((p) => p.path === path)?.sessions ?? []

  return (
    <div style={{ position: 'relative' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 500 }}>Projects</h2>
        <button
          onClick={() => setDrawerOpen(true)}
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

      {/* Active projects */}
      {activeProjects.length === 0 && (
        <div style={{ color: 'var(--fg-subtle)', fontSize: 12, padding: '24px 0' }}>
          No projects yet. Add a project directory to get started.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
        {activeProjects.map((project) => {
          const liveSessions = getLiveSessions(project.path)
          const activeCount = liveSessions.filter((s) => s.state === 'running').length
          const agentTypes = [...new Set(liveSessions.map((s) => s.agentType))]
          const name = project.name ?? project.path.split('/').filter(Boolean).pop() ?? project.path
          const isDeleting = deleteTarget === project.path

          return (
            <div
              key={project.path}
              style={{
                padding: '12px 16px',
                border: '1px solid var(--border)',
                borderRadius: 6,
                backgroundColor: 'var(--bg-panel)'
              }}
            >
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}
              >
                <span style={{ fontWeight: 500 }}>{name}</span>
                <span
                  className="mono"
                  style={{
                    fontSize: 11,
                    color: 'var(--fg-subtle)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    direction: 'rtl',
                    textAlign: 'left',
                    flex: 1
                  }}
                >
                  {project.path}
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: 11,
                  color: 'var(--fg-subtle)'
                }}
              >
                {activeCount > 0 ? (
                  <span style={{ color: 'var(--status-running)' }}>
                    ● {activeCount} active
                  </span>
                ) : (
                  <span>{liveSessions.length} sessions</span>
                )}
                {agentTypes.map((t) => (
                  <span
                    key={t}
                    style={{
                      padding: '1px 6px',
                      border: '1px solid var(--border)',
                      borderRadius: 3,
                      fontSize: 10
                    }}
                  >
                    {t}
                  </span>
                ))}
                <div style={{ flex: 1 }} />
                <button
                  onClick={() => setDeleteTarget(isDeleting ? null : project.path)}
                  style={{
                    padding: '2px 8px',
                    fontSize: 11,
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    background: 'transparent',
                    color: 'var(--fg-subtle)',
                    cursor: 'pointer'
                  }}
                  aria-label="Project settings"
                >
                  ⚙
                </button>
                <button
                  onClick={() => handleArchive(project)}
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
              {isDeleting && (
                <DeleteConfirm
                  project={project}
                  onCancel={() => setDeleteTarget(null)}
                  onDeleted={() => setDeleteTarget(null)}
                />
              )}
            </div>
          )
        })}
      </div>

      {/* Archived section */}
      {archivedProjects.length > 0 && (
        <div>
          <button
            onClick={() => setArchivedExpanded((v) => !v)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'none',
              border: 'none',
              color: 'var(--fg-subtle)',
              cursor: 'pointer',
              fontSize: 11,
              padding: '4px 0',
              marginBottom: 8
            }}
          >
            <span>{archivedExpanded ? '▼' : '▶'}</span>
            <span>Archived ({archivedProjects.length})</span>
          </button>
          {archivedExpanded && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {archivedProjects.map((project) => {
                const name =
                  project.name ??
                  project.path.split('/').filter(Boolean).pop() ??
                  project.path
                return (
                  <div
                    key={project.path}
                    style={{
                      padding: '10px 16px',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      backgroundColor: 'var(--bg-panel)',
                      opacity: 0.6,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      fontSize: 12
                    }}
                  >
                    <span style={{ fontWeight: 500 }}>{name}</span>
                    <span
                      className="mono"
                      style={{
                        fontSize: 11,
                        color: 'var(--fg-subtle)',
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {project.path}
                    </span>
                    <button
                      onClick={() => handleRestore(project.path)}
                      style={{
                        padding: '2px 8px',
                        fontSize: 11,
                        border: '1px solid var(--accent)',
                        borderRadius: 4,
                        background: 'transparent',
                        color: 'var(--accent)',
                        cursor: 'pointer'
                      }}
                    >
                      Restore
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Add Project drawer */}
      {drawerOpen && (
        <AddProjectDrawer
          onClose={() => setDrawerOpen(false)}
          onAdded={() => setDrawerOpen(false)}
        />
      )}

      {/* Undo toast */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'var(--bg-panel)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '10px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontSize: 12,
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            zIndex: 1000
          }}
        >
          <span style={{ color: 'var(--fg-primary)' }}>{toast.message}</span>
          <button
            onClick={() => {
              clearTimeout(toast.timeoutId)
              toast.onUndo()
            }}
            style={{
              padding: '3px 10px',
              fontSize: 11,
              fontWeight: 500,
              border: '1px solid var(--accent)',
              borderRadius: 4,
              background: 'transparent',
              color: 'var(--accent)',
              cursor: 'pointer'
            }}
          >
            Undo
          </button>
        </div>
      )}
    </div>
  )
}

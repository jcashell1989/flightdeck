import { useEffect, useMemo, useState } from 'react'
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

type SortKey = 'status' | 'agent' | 'id' | 'project' | 'action' | 'activity'
type SortDir = 'asc' | 'desc'

interface FlatSession extends Session {
  projectName: string
}

function compareBy(a: FlatSession, b: FlatSession, key: SortKey): number {
  switch (key) {
    case 'status':
      return STATUS_LABELS[a.state].localeCompare(STATUS_LABELS[b.state])
    case 'agent':
      return a.agentType.localeCompare(b.agentType)
    case 'id':
      return a.id.localeCompare(b.id)
    case 'project':
      return a.projectName.localeCompare(b.projectName)
    case 'action':
      return (a.currentAction ?? '').localeCompare(b.currentAction ?? '')
    case 'activity':
      return a.lastActivity - b.lastActivity
  }
}

export function Sessions({ projects, onSessionClick }: SessionsProps) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [attentionOnly, setAttentionOnly] = useState(false)

  // 'A' keyboard shortcut toggles the attention filter (spec-ux §7).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'a' && e.key !== 'A') return
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return
      }
      e.preventDefault()
      setAttentionOnly((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const allSessions = useMemo<FlatSession[]>(() => {
    const flat: FlatSession[] = projects.flatMap((p) =>
      p.sessions.map((s) => ({ ...s, projectName: p.name }))
    )
    const filtered = attentionOnly ? flat.filter((s) => isAttention(s.state)) : flat
    if (sortKey === null) {
      // Default: attention-first, then by recency desc.
      filtered.sort((a, b) => {
        const aAtt = isAttention(a.state)
        const bAtt = isAttention(b.state)
        if (aAtt && !bAtt) return -1
        if (!aAtt && bAtt) return 1
        return b.lastActivity - a.lastActivity
      })
    } else {
      filtered.sort((a, b) => {
        const cmp = compareBy(a, b, sortKey)
        return sortDir === 'asc' ? cmp : -cmp
      })
    }
    return filtered
  }, [projects, sortKey, sortDir, attentionOnly])

  const handleHeaderClick = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sortIndicator = (key: SortKey): string => {
    if (sortKey !== key) return ''
    return sortDir === 'asc' ? ' ▲' : ' ▼'
  }

  const headerCellStyle = {
    padding: '6px 8px',
    fontWeight: 500 as const,
    cursor: 'pointer' as const,
    userSelect: 'none' as const
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, gap: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 500, margin: 0 }}>Sessions</h2>
        <button
          onClick={() => setAttentionOnly((v) => !v)}
          aria-pressed={attentionOnly}
          title="Toggle attention filter (A)"
          style={{
            fontSize: 11,
            padding: '4px 10px',
            background: attentionOnly ? 'var(--status-error, #c33)' : 'transparent',
            color: attentionOnly ? '#fff' : 'var(--fg-muted)',
            border: `1px solid ${attentionOnly ? 'var(--status-error, #c33)' : 'var(--border)'}`,
            borderRadius: 3,
            cursor: 'pointer'
          }}
        >
          {attentionOnly ? 'Attention only ✕' : 'Attention only'}
        </button>
        <span style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>
          {allSessions.length} session{allSessions.length === 1 ? '' : 's'}
          {attentionOnly ? ' (filtered)' : ''}
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--fg-subtle)', textAlign: 'left' }}>
            <th style={headerCellStyle} onClick={() => handleHeaderClick('status')}>Status{sortIndicator('status')}</th>
            <th style={headerCellStyle} onClick={() => handleHeaderClick('agent')}>Agent{sortIndicator('agent')}</th>
            <th style={headerCellStyle} onClick={() => handleHeaderClick('id')}>ID{sortIndicator('id')}</th>
            <th style={headerCellStyle} onClick={() => handleHeaderClick('project')}>Project{sortIndicator('project')}</th>
            <th style={headerCellStyle} onClick={() => handleHeaderClick('action')}>Action{sortIndicator('action')}</th>
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
              <td style={{ padding: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <StatusDot state={s.state} />
                  <span style={{ color: `var(--status-${s.state})` }}>{STATUS_LABELS[s.state]}</span>
                </div>
              </td>
              <td style={{ padding: '8px', color: 'var(--fg-muted)' }}>{s.agentType}</td>
              <td className="mono" style={{ padding: '8px', color: 'var(--fg-subtle)' }} title={s.id}>#{s.id.slice(-4)}</td>
              <td style={{ padding: '8px', color: 'var(--fg-muted)' }}>{s.projectName}</td>
              <td className="mono" style={{ padding: '8px', color: 'var(--fg-primary)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.currentAction}
              </td>
            </tr>
          ))}
          {allSessions.length === 0 && (
            <tr>
              <td colSpan={5} style={{ padding: 24, textAlign: 'center', color: 'var(--fg-subtle)' }}>
                {attentionOnly ? 'No sessions need attention.' : 'No sessions.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  )
}

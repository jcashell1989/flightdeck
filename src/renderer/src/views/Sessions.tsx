import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useMemo, useState } from 'react'
import { Project, Session, isAttention } from '../types'
import { StatusDot } from '../components/StatusDot'
import { STATUS_LABELS, SortKey, FlatSession, compareBy } from './sessionsSort'

interface SessionsProps {
  projects: Project[]
  onSessionClick: (session: Session) => void
  attentionOnly: boolean
  setAttentionOnly: (value: boolean | ((prev: boolean) => boolean)) => void
}

type SortDir = 'asc' | 'desc'

export function Sessions({ projects, onSessionClick, attentionOnly, setAttentionOnly }: SessionsProps) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  // Note: the global 'A' keyboard shortcut (spec-ux §7) is handled by
  // useKeyboardNav → App.onAttentionFilter, which navigates here AND sets
  // attentionOnly=true. Keeping the state lifted to App ensures a single
  // A press from any view lands on the filtered Sessions view.

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

  const headerKey = (key: SortKey) => (e: ReactKeyboardEvent<HTMLTableCellElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleHeaderClick(key)
    }
  }

  const ariaSort = (key: SortKey): 'ascending' | 'descending' | 'none' => {
    if (sortKey !== key) return 'none'
    return sortDir === 'asc' ? 'ascending' : 'descending'
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
            <th scope="col" role="columnheader" tabIndex={0} aria-sort={ariaSort('status')} style={headerCellStyle} onClick={() => handleHeaderClick('status')} onKeyDown={headerKey('status')}>Status{sortIndicator('status')}</th>
            <th scope="col" role="columnheader" tabIndex={0} aria-sort={ariaSort('agent')} style={headerCellStyle} onClick={() => handleHeaderClick('agent')} onKeyDown={headerKey('agent')}>Agent{sortIndicator('agent')}</th>
            <th scope="col" role="columnheader" tabIndex={0} aria-sort={ariaSort('id')} style={headerCellStyle} onClick={() => handleHeaderClick('id')} onKeyDown={headerKey('id')}>ID{sortIndicator('id')}</th>
            <th scope="col" role="columnheader" tabIndex={0} aria-sort={ariaSort('project')} style={headerCellStyle} onClick={() => handleHeaderClick('project')} onKeyDown={headerKey('project')}>Project{sortIndicator('project')}</th>
            <th scope="col" role="columnheader" tabIndex={0} aria-sort={ariaSort('action')} style={headerCellStyle} onClick={() => handleHeaderClick('action')} onKeyDown={headerKey('action')}>Action{sortIndicator('action')}</th>
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

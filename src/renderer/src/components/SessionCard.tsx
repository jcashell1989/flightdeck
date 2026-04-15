import { useState } from 'react'
import { Session, SessionState, isAttention } from '../types'
import { StatusDot } from './StatusDot'
import { useElapsedTick } from '../hooks/useElapsedTick'

interface SessionCardProps {
  session: Session
  focused: boolean
  onClick: () => void
}

const STATUS_LABELS: Record<SessionState, string> = {
  running: '▶ running',
  idle: '◌ idle',
  approval: '⏸ waiting',
  question: '⏸ waiting',
  review: '✓ done',
  error: '✗ error'
}

const ACTION_ICONS: Record<SessionState, string> = {
  running: '✎',
  idle: '◌',
  approval: '⏸',
  question: '⏸',
  review: '✓',
  error: '✗'
}

function borderStyle(state: SessionState): string | undefined {
  switch (state) {
    case 'approval': return 'var(--border-approval)'
    case 'question': return 'var(--border-question)'
    case 'review':   return 'var(--border-review)'
    case 'error':    return 'var(--border-error)'
    case 'idle':     return 'var(--fg-subtle)'
    default: return undefined
  }
}

function tintStyle(state: SessionState): string | undefined {
  switch (state) {
    case 'approval': return 'var(--tint-approval)'
    case 'question': return 'var(--tint-question)'
    case 'review':   return 'var(--tint-review)'
    case 'error':    return 'var(--tint-error)'
    default: return undefined
  }
}

function formatElapsed(ms: number): string {
  // Clamp to 0: a session.startedAt in the future (clock skew, future-dated
  // mock data) would otherwise render as "-5s".
  const sec = Math.max(0, Math.floor(ms / 1000))
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  return `${hr}h ${min % 60}m`
}

function formatRelative(ts: number, now: number): string {
  const diff = Math.floor((now - ts) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`
  return `${Math.floor(diff / 3600)}h ago`
}

export function SessionCard({ session, focused, onClick }: SessionCardProps) {
  const now = useElapsedTick()
  const [hovered, setHovered] = useState(false)
  const leftBorder = borderStyle(session.state)
  const tint = tintStyle(session.state)
  const attention = isAttention(session.state)
  // `idle` gets a thinner border than the loud attention states.
  const borderWidth = session.state === 'idle' ? 2 : 3
  const elapsedMs = now - session.startedAt

  // Abort button: use adapter-stamped canAbort when present, fall back to agentType heuristic.
  const canAbort =
    session.state === 'running' &&
    (session.canAbort ?? session.agentType === 'opencode')

  const handleAbort = (e: React.MouseEvent) => {
    e.stopPropagation()
    window.electronAPI?.opencode?.abortSession(session.id)
  }

  const borderColor = focused ? 'var(--accent)' : hovered ? 'var(--border-active)' : 'var(--border)'

  return (
    <div
      role="button"
      aria-label={`${session.agentType} session ${session.id.slice(-4)}, ${session.state}: ${session.currentAction}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      tabIndex={0}
      style={{
        height: 88,
        minWidth: 280,
        padding: '10px 12px',
        borderRadius: 6,
        border: `1px solid ${borderColor}`,
        borderLeft: leftBorder
          ? `${borderWidth}px solid ${leftBorder}`
          : `1px solid ${borderColor}`,
        backgroundColor: tint ?? 'var(--bg-panel)',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        transition: 'border-color 0.15s, background-color 0.15s'
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 20 }}>
        <StatusDot state={session.state} />
        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{session.agentType}</span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--fg-subtle)' }} title={session.id}>#{session.id.slice(-4)}</span>
        <div style={{ flex: 1 }} />
        {attention && (
          <span style={{ fontSize: 11, color: leftBorder }}>⚠</span>
        )}
        {canAbort && hovered && (
          <button
            type="button"
            onClick={handleAbort}
            aria-label="Abort session"
            title="Abort session"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--fg-subtle)',
              cursor: 'pointer',
              fontSize: 12,
              padding: '0 2px',
              lineHeight: 1
            }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Current action */}
      <div
        className="mono"
        style={{
          fontSize: 12,
          color: session.state === 'idle' ? 'var(--fg-muted)' : 'var(--fg-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        {ACTION_ICONS[session.state]} {session.currentAction}
      </div>

      {/* Status line: last end_turn text snippet */}
      {session.statusLine && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--fg-subtle)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {session.statusLine}
        </div>
      )}

      {/* Status row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
        <span style={{ fontWeight: 500, color: `var(--status-${session.state})` }}>
          {STATUS_LABELS[session.state]}
        </span>
        <span className="mono" style={{ color: 'var(--fg-subtle)' }}>
          {formatElapsed(elapsedMs)}
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ color: 'var(--fg-subtle)' }}>
          {formatRelative(session.lastActivity, now)}
        </span>
      </div>
    </div>
  )
}

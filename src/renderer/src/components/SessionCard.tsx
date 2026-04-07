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
  const sec = Math.floor(ms / 1000)
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
  const leftBorder = borderStyle(session.state)
  const tint = tintStyle(session.state)
  const attention = isAttention(session.state)
  // `idle` gets a thinner border than the loud attention states.
  const borderWidth = session.state === 'idle' ? 2 : 3
  const elapsedMs = now - session.startedAt

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
      tabIndex={0}
      style={{
        height: 88,
        minWidth: 280,
        padding: '10px 12px',
        borderRadius: 6,
        border: focused ? '1px solid var(--accent)' : '1px solid var(--border)',
        borderLeft: leftBorder
          ? `${borderWidth}px solid ${leftBorder}`
          : focused
            ? '1px solid var(--accent)'
            : '1px solid var(--border)',
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

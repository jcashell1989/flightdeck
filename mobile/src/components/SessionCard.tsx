import type { Session, SessionState } from '@shared/types'
import { StatusDot } from './StatusDot'

interface SessionCardProps {
  session: Session
  projectName: string
  onClick: () => void
}

const STATUS_LABELS: Record<SessionState, string> = {
  running: '▶ running',
  idle: '◌ idle',
  approval: '⏸ waiting',
  question: '⏸ waiting',
  review: '✓ done',
  error: '✗ error',
}

const statusColors: Record<string, string> = {
  running: '#22c55e',
  idle: '#eab308',
  approval: '#f97316',
  question: '#3b82f6',
  error: '#ef4444',
  review: '#a855f7',
}

function formatElapsed(ms: number): string {
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

const ATTENTION_STATES = new Set<SessionState>(['approval', 'question', 'error'])

export function SessionCard({ session, projectName, onClick }: SessionCardProps) {
  const now = Date.now()
  const elapsedMs = now - session.startedAt
  const attention = ATTENTION_STATES.has(session.state)

  const borderLeftColor = attention ? statusColors[session.state] : '#3f3f46'

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${session.agentType} session in ${projectName}, ${session.state}: ${session.currentAction}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() }
      }}
      className="session-card"
      style={{
        borderLeft: `3px solid ${borderLeftColor}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <StatusDot state={session.state} />
        <span style={{ fontSize: 12, color: '#a1a1aa' }}>{session.agentType}</span>
        <span style={{ fontSize: 11, color: '#71717a', fontFamily: 'monospace' }} title={session.id}>
          #{session.id.slice(-4)}
        </span>
        {attention && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: statusColors[session.state] }}>⚠</span>
        )}
      </div>

      <div style={{
        fontSize: 12,
        color: session.state === 'idle' ? '#a1a1aa' : '#e5e5e5',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontFamily: 'monospace',
        marginBottom: 4,
      }}>
        {session.currentAction}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
        <span style={{ fontWeight: 500, color: statusColors[session.state] ?? '#a1a1aa' }}>
          {STATUS_LABELS[session.state]}
        </span>
        <span style={{ color: '#71717a', fontFamily: 'monospace' }}>{formatElapsed(elapsedMs)}</span>
        <div style={{ flex: 1 }} />
        <span style={{ color: '#71717a' }}>{formatRelative(session.lastActivity, now)}</span>
      </div>
    </div>
  )
}

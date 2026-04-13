import type { SessionState } from '@shared/types'

const colors: Record<string, string> = {
  running: '#22c55e',
  idle: '#eab308',
  approval: '#f97316',
  question: '#3b82f6',
  error: '#ef4444',
  review: '#a855f7',
}

const labels: Record<string, string> = {
  running: 'Running',
  idle: 'Idle',
  approval: 'Needs approval',
  question: 'Has question',
  review: 'Review changes',
  error: 'Error',
}

const pulsing = new Set<SessionState>(['approval', 'question'])

export function StatusDot({ state }: { state: SessionState }) {
  const color = colors[state] ?? '#6b7280'
  const label = labels[state] ?? state

  return (
    <span
      role="img"
      aria-label={`Status: ${label}`}
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        backgroundColor: color,
        flexShrink: 0,
        animation: pulsing.has(state) ? 'pulse 1.5s ease-in-out infinite' : undefined,
      }}
    />
  )
}

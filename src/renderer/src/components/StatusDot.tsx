import { SessionState } from '../types'

const STATUS_COLORS: Record<SessionState, string> = {
  running: 'var(--status-running)',
  idle: 'var(--status-idle)',
  approval: 'var(--status-approval)',
  question: 'var(--status-question)',
  review: 'var(--status-review)',
  error: 'var(--status-error)'
}

const PULSING: Set<SessionState> = new Set(['approval', 'question'])

export function StatusDot({ state }: { state: SessionState }) {
  return (
    <span
      className={PULSING.has(state) ? 'status-dot--pulsing' : undefined}
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        backgroundColor: STATUS_COLORS[state],
        flexShrink: 0
      }}
    />
  )
}

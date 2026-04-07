import { Session } from '../types'

interface TopBarProps {
  sessions: Session[]
}

export function TopBar({ sessions }: TopBarProps) {
  const attentionCount = sessions.filter(
    (s) => s.state === 'approval' || s.state === 'question' || s.state === 'review'
  ).length
  const runningCount = sessions.filter((s) => s.state === 'running').length

  return (
    <header
      style={{
        height: 40,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        borderBottom: '1px solid var(--border)',
        backgroundColor: 'var(--bg-panel)',
        // @ts-expect-error Electron-specific CSS property
        WebkitAppRegion: 'drag',
        flexShrink: 0
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 68 }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            backgroundColor: 'var(--status-running)'
          }}
        />
        <span className="mono" style={{ fontWeight: 600, fontSize: 13, letterSpacing: '0.04em' }}>
          AGENTCTL
        </span>
      </div>

      {/* @ts-expect-error Electron-specific CSS property */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, WebkitAppRegion: 'no-drag' }}>
        {attentionCount > 0 && (
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              color: 'var(--status-approval)',
              fontSize: 12,
              fontWeight: 500
            }}
          >
            ⚠ {attentionCount}
          </span>
        )}

        <span
          className="mono"
          style={{
            fontSize: 12,
            padding: '2px 8px',
            borderRadius: 4,
            border: '1px solid var(--border)',
            color: 'var(--fg-muted)',
            cursor: 'pointer'
          }}
        >
          ⌘K Dispatch
        </span>

        {runningCount > 0 && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--fg-muted)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: 'var(--status-running)' }} />
            {runningCount} running
          </span>
        )}
      </div>
    </header>
  )
}

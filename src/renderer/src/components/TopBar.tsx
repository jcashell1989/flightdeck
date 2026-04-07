import { useEffect, useState } from 'react'
import { Session, isAttention, ConnectionStatus } from '../types'

interface TopBarProps {
  sessions: Session[]
  connectionStatus?: ConnectionStatus
  onCmdKClick?: () => void
}

// Grace period (ms) before showing the "connecting" banner on cold start.
// Avoids a flash on every launch when hydrate completes within ~half a second.
const CONNECTING_BANNER_GRACE_MS = 600

export function TopBar({ sessions, connectionStatus = 'disabled', onCmdKClick }: TopBarProps) {
  const attentionCount = sessions.filter((s) => isAttention(s.state)).length
  const runningCount = sessions.filter((s) => s.state === 'running').length

  // Suppress the "connecting" banner during the initial grace window so the
  // common case (mock-off, hydrate succeeds within a few hundred ms) doesn't
  // flash a banner. Errors and reconnects are shown immediately.
  const [graceElapsed, setGraceElapsed] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setGraceElapsed(true), CONNECTING_BANNER_GRACE_MS)
    return () => clearTimeout(id)
  }, [])

  const showConnectionBanner =
    connectionStatus === 'reconnecting' ||
    connectionStatus === 'error' ||
    (connectionStatus === 'connecting' && graceElapsed)

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
        {showConnectionBanner && (
          <span
            style={{
              fontSize: 11,
              color: connectionStatus === 'error' ? 'var(--status-error)' : 'var(--fg-muted)',
              fontWeight: 500
            }}
          >
            {connectionStatus === 'connecting' && '… connecting'}
            {connectionStatus === 'reconnecting' && '… reconnecting'}
            {connectionStatus === 'error' && '⚠ disconnected'}
          </span>
        )}
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

        <button
          type="button"
          onClick={onCmdKClick}
          className="mono"
          style={{
            fontSize: 12,
            padding: '2px 8px',
            borderRadius: 4,
            border: '1px solid var(--border)',
            color: 'var(--fg-muted)',
            backgroundColor: 'transparent',
            cursor: 'pointer'
          }}
        >
          ⌘K Dispatch
        </button>

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

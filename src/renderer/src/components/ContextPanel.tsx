import { Session } from '../types'
import { StatusDot } from './StatusDot'

interface ContextPanelProps {
  session: Session | null
  onClose: () => void
}

export function ContextPanel({ session, onClose }: ContextPanelProps) {
  if (!session) return null

  return (
    <div
      style={{
        flex: 2,
        minWidth: 0,
        borderLeft: '1px solid var(--border)',
        backgroundColor: 'var(--bg-panel)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      {/* Panel header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0
        }}
      >
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--fg-muted)',
            cursor: 'pointer',
            fontSize: 13
          }}
        >
          ← Back
        </button>
        <StatusDot state={session.state} />
        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{session.agentType}</span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>#{session.id}</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--fg-subtle)',
            cursor: 'pointer',
            fontSize: 14
          }}
        >
          ✕
        </button>
      </div>

      {/* Tab bar (shell — Phase 3 adds real tabs) */}
      <div
        style={{
          display: 'flex',
          gap: 0,
          borderBottom: '1px solid var(--border)',
          flexShrink: 0
        }}
      >
        {['Conversation', 'Diff', 'Todo'].map((tab, i) => (
          <button
            key={tab}
            style={{
              flex: 1,
              padding: '8px 12px',
              fontSize: 12,
              background: i === 0 ? 'var(--bg-element)' : 'transparent',
              border: 'none',
              borderBottom: i === 0 ? '2px solid var(--accent)' : '2px solid transparent',
              color: i === 0 ? 'var(--fg-primary)' : 'var(--fg-subtle)',
              cursor: 'pointer'
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Placeholder content */}
      <div style={{ flex: 1, padding: 16, overflow: 'auto' }}>
        {(session.state === 'approval' || session.state === 'question' || session.state === 'review') && (
          <AttentionBanner session={session} />
        )}
        <div style={{ color: 'var(--fg-subtle)', fontSize: 12, marginTop: 16, textAlign: 'center' }}>
          Conversation view — Phase 3
        </div>
      </div>

      {/* Reply input shell */}
      <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
        <input
          type="text"
          placeholder="Reply to agent…"
          disabled
          style={{
            width: '100%',
            padding: '8px 10px',
            fontSize: 12,
            fontFamily: '"Berkeley Mono", "SF Mono", monospace',
            border: '1px solid var(--border)',
            borderRadius: 4,
            backgroundColor: 'var(--bg-base)',
            color: 'var(--fg-primary)',
            outline: 'none'
          }}
        />
      </div>
    </div>
  )
}

function AttentionBanner({ session }: { session: Session }) {
  const color =
    session.state === 'approval' ? 'var(--border-approval)' :
    session.state === 'question' ? 'var(--border-question)' :
    'var(--border-review)'

  const tint =
    session.state === 'approval' ? 'var(--tint-approval)' :
    session.state === 'question' ? 'var(--tint-question)' :
    'var(--tint-review)'

  const label =
    session.state === 'approval' ? 'WAITING FOR APPROVAL' :
    session.state === 'question' ? 'WAITING FOR INPUT' :
    'REVIEW CHANGES'

  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 6,
        border: `1px solid ${color}`,
        backgroundColor: tint,
        fontSize: 12
      }}
    >
      <div style={{ fontWeight: 600, color, marginBottom: 6, fontSize: 11, letterSpacing: '0.04em' }}>
        ⚠ {label}
      </div>
      <div className="mono" style={{ color: 'var(--fg-primary)', marginBottom: 8 }}>
        {session.currentAction}
      </div>
      {session.state === 'approval' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={bannerBtn(color)}>Allow</button>
          <button style={bannerBtn('var(--fg-subtle)')}>Deny</button>
        </div>
      )}
      {session.state === 'review' && (
        <button style={bannerBtn(color)}>Mark Reviewed</button>
      )}
    </div>
  )
}

function bannerBtn(color: string): React.CSSProperties {
  return {
    padding: '4px 12px',
    fontSize: 11,
    fontWeight: 500,
    border: `1px solid ${color}`,
    borderRadius: 4,
    background: 'transparent',
    color,
    cursor: 'pointer'
  }
}

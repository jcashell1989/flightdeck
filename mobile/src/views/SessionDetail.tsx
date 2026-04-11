import { useState } from 'react'
import type { Session } from '@shared/types'
import { StatusDot } from '../components/StatusDot'
import { respond, abort } from '../api'

interface SessionDetailProps {
  session: Session
  projectName: string
  onBack: () => void
}

const statusColors: Record<string, string> = {
  running: '#22c55e',
  idle: '#eab308',
  approval: '#f97316',
  question: '#3b82f6',
  error: '#ef4444',
  review: '#a855f7',
}

export function SessionDetail({ session, projectName, onBack }: SessionDetailProps) {
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  async function handleRespond(response: 'once' | 'always' | 'reject') {
    if (!session.pendingPermission) return
    setBusy(true)
    setActionError(null)
    try {
      await respond(session.id, session.pendingPermission.id, response)
    } catch (e: unknown) {
      setActionError(String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleAbort() {
    setBusy(true)
    setActionError(null)
    try {
      await abort(session.id)
    } catch (e: unknown) {
      setActionError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ padding: '1rem' }}>
      <button
        type="button"
        onClick={onBack}
        style={{
          background: 'transparent',
          border: 'none',
          color: '#a1a1aa',
          cursor: 'pointer',
          fontSize: 14,
          padding: '0 0 1rem 0',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        ← Back
      </button>

      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: 12, color: '#71717a', marginBottom: 4 }}>{projectName}</div>
        <div style={{ fontSize: 13, color: '#71717a', fontFamily: 'monospace' }}>
          #{session.id.slice(-8)}
        </div>
      </div>

      <div style={{
        background: '#27272a',
        borderRadius: 8,
        padding: '1rem',
        marginBottom: '1rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <StatusDot state={session.state} />
          <span style={{ fontWeight: 600, color: statusColors[session.state] ?? '#e5e5e5', fontSize: 14 }}>
            {session.state}
          </span>
          <span style={{ fontSize: 11, color: '#52525b', marginLeft: 'auto' }}>
            {session.agentType}
          </span>
        </div>
        <div style={{ fontSize: 12, color: '#a1a1aa', fontFamily: 'monospace' }}>
          {session.currentAction}
        </div>
      </div>

      {session.pendingPermission && (
        <div style={{
          background: '#1c1917',
          border: '1px solid #f97316',
          borderRadius: 8,
          padding: '1rem',
          marginBottom: '1rem',
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#f97316', marginBottom: 8 }}>
            Permission Request
          </div>
          {session.pendingPermission.title && (
            <div style={{ fontSize: 13, color: '#e5e5e5', marginBottom: 4 }}>
              {session.pendingPermission.title}
            </div>
          )}
          {session.pendingPermission.command && (
            <div style={{ fontSize: 12, color: '#a1a1aa', fontFamily: 'monospace', marginBottom: 8 }}>
              {session.pendingPermission.command}
            </div>
          )}
          {session.pendingPermission.pattern && (
            <div style={{ fontSize: 12, color: '#a1a1aa', fontFamily: 'monospace', marginBottom: 8 }}>
              {session.pendingPermission.pattern}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={busy}
              onClick={() => handleRespond('once')}
              style={{
                background: '#16a34a',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '8px 16px',
                fontSize: 13,
                cursor: busy ? 'not-allowed' : 'pointer',
                opacity: busy ? 0.6 : 1,
              }}
            >
              Approve once
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => handleRespond('always')}
              style={{
                background: '#15803d',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '8px 16px',
                fontSize: 13,
                cursor: busy ? 'not-allowed' : 'pointer',
                opacity: busy ? 0.6 : 1,
              }}
            >
              Always allow
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => handleRespond('reject')}
              style={{
                background: '#991b1b',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '8px 16px',
                fontSize: 13,
                cursor: busy ? 'not-allowed' : 'pointer',
                opacity: busy ? 0.6 : 1,
              }}
            >
              Reject
            </button>
          </div>
        </div>
      )}

      {session.state === 'running' && session.agentType === 'opencode' && (
        <button
          type="button"
          disabled={busy}
          onClick={handleAbort}
          style={{
            background: '#7f1d1d',
            color: '#fca5a5',
            border: '1px solid #991b1b',
            borderRadius: 6,
            padding: '8px 16px',
            fontSize: 13,
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.6 : 1,
            width: '100%',
            marginBottom: '1rem',
          }}
        >
          Abort session
        </button>
      )}

      {actionError && (
        <div style={{ color: '#ef4444', fontSize: 12, marginTop: 8 }}>
          {actionError}
        </div>
      )}
    </div>
  )
}

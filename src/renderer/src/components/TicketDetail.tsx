import type { TdTicket } from '../../../shared/types'
import { useState } from 'react'

interface TicketDetailProps {
  ticket: TdTicket | null
  loading: boolean
  onStart: (id: string) => void
  onHandoff: (id: string) => void
  onLog: (id: string, message: string) => void
}

export function TicketDetail({ ticket, loading, onStart, onHandoff, onLog }: TicketDetailProps) {
  const [logMsg, setLogMsg] = useState('')

  if (loading) {
    return <div style={{ padding: 16, color: 'var(--fg-muted)', fontSize: 12 }}>Loading...</div>
  }
  if (!ticket) {
    return <div style={{ padding: 16, color: 'var(--fg-muted)', fontSize: 12 }}>Select a ticket</div>
  }

  const handleLog = () => {
    if (!logMsg.trim()) return
    onLog(ticket.id, logMsg.trim())
    setLogMsg('')
  }

  return (
    <div style={{ padding: 16, height: '100%', overflowY: 'auto', fontSize: 12 }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4, color: 'var(--fg-primary)' }}>{ticket.title}</div>
      <div style={{ color: 'var(--fg-muted)', fontFamily: 'monospace', marginBottom: 8 }}>{ticket.id}</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <span style={{ background: 'var(--bg-element)', color: 'var(--fg-muted)', borderRadius: 4, padding: '2px 6px' }}>{ticket.status}</span>
        <span style={{ background: 'var(--bg-element)', color: 'var(--fg-muted)', borderRadius: 4, padding: '2px 6px' }}>{ticket.priority}</span>
        <span style={{ background: 'var(--bg-element)', color: 'var(--fg-muted)', borderRadius: 4, padding: '2px 6px' }}>{ticket.type}</span>
      </div>
      {ticket.description && (
        <div style={{ color: 'var(--fg-primary)', marginBottom: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
          {ticket.description}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {ticket.status === 'open' && (
          <button onClick={() => onStart(ticket.id)} style={btnStyle}>Start</button>
        )}
        {ticket.status === 'in_progress' && (
          <button onClick={() => onHandoff(ticket.id)} style={btnStyle}>Handoff</button>
        )}
      </div>
      {ticket.logs && ticket.logs.length > 0 && (
        <div>
          <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--fg-muted)' }}>Log</div>
          {ticket.logs.slice().reverse().map((entry, i) => (
            <div key={i} style={{ marginBottom: 6, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
              <div style={{ color: 'var(--fg-muted)', marginBottom: 2 }}>{new Date(entry.timestamp).toLocaleString()}</div>
              <div style={{ color: 'var(--fg-primary)', whiteSpace: 'pre-wrap' }}>{entry.message}</div>
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--fg-muted)' }}>Add log entry</div>
        <textarea
          value={logMsg}
          onChange={(e) => setLogMsg(e.target.value)}
          placeholder="Log message..."
          rows={2}
          style={{
            width: '100%',
            background: 'var(--bg-input, var(--bg-element))',
            border: '1px solid var(--border)',
            borderRadius: 4,
            color: 'var(--fg-primary)',
            fontSize: 12,
            padding: '4px 8px',
            resize: 'vertical',
            boxSizing: 'border-box',
            marginBottom: 6,
          }}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleLog() }}
        />
        <button onClick={handleLog} disabled={!logMsg.trim()} style={btnStyle}>Log (⌘↵)</button>
      </div>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  background: 'var(--bg-element)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  color: 'var(--fg-primary)',
  cursor: 'pointer',
  fontSize: 11,
  padding: '3px 10px',
}

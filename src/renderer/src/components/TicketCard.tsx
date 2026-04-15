import type { TdTicket } from '../../../shared/types'

const PRIORITY_COLORS: Record<string, string> = {
  P0: 'var(--status-error)',
  P1: '#e08c3a',
  P2: 'var(--fg-muted)',
  P3: 'var(--fg-muted)',
}

interface TicketCardProps {
  ticket: TdTicket
  selected: boolean
  onClick: (id: string) => void
}

export function TicketCard({ ticket, selected, onClick }: TicketCardProps) {
  return (
    <button
      onClick={() => onClick(ticket.id)}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        background: selected ? 'var(--bg-element)' : 'var(--bg-card, var(--bg-panel))',
        border: selected ? '1px solid var(--accent)' : '1px solid var(--border)',
        borderRadius: 6,
        padding: '8px 10px',
        cursor: 'pointer',
        marginBottom: 6,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: 'var(--fg-muted)', fontFamily: 'monospace' }}>{ticket.id}</span>
        <span style={{ fontSize: 10, color: PRIORITY_COLORS[ticket.priority] ?? 'var(--fg-muted)', fontWeight: 600 }}>{ticket.priority}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--fg-primary)', lineHeight: 1.4, wordBreak: 'break-word' }}>
        {ticket.title}
      </div>
    </button>
  )
}

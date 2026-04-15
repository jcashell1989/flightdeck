import { useMemo } from 'react'
import { useTd } from '../hooks/useTd'
import { TicketCard } from '../components/TicketCard'
import { TicketDetail } from '../components/TicketDetail'
import type { TdTicket } from '../../../shared/types'

const COLUMNS: { id: string; label: string; statuses: TdTicket['status'][] }[] = [
  { id: 'backlog',  label: 'Backlog',     statuses: ['open'] },
  { id: 'active',   label: 'In Progress', statuses: ['in_progress'] },
  { id: 'review',   label: 'Review',      statuses: ['in_review'] },
  { id: 'done',     label: 'Done',        statuses: ['approved', 'closed'] },
]

interface KanbanViewProps {
  cwd?: string
}

export function KanbanView({ cwd }: KanbanViewProps) {
  const { tickets, loading, error, refresh, selectedId, detail, detailLoading, loadDetail, start, log, handoff } = useTd(cwd)
  const ticketsByStatus = useMemo<Record<TdTicket['status'], TdTicket[]>>(() => {
    const grouped: Record<TdTicket['status'], TdTicket[]> = {
      open: [],
      in_progress: [],
      in_review: [],
      approved: [],
      closed: [],
    }
    for (const ticket of tickets) grouped[ticket.status].push(ticket)
    return grouped
  }, [tickets])

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Kanban columns */}
      <div style={{ flex: 1, display: 'flex', gap: 12, padding: 16, overflowX: 'auto', overflowY: 'hidden' }}>
        {loading && tickets.length === 0 && (
          <div style={{ color: 'var(--fg-muted)', fontSize: 12 }}>Loading tickets...</div>
        )}
        {error && (
          <div style={{ color: 'var(--status-error)', fontSize: 12 }}>{error}</div>
        )}
        {COLUMNS.map((col) => {
          const colTickets = col.statuses.flatMap((status) => ticketsByStatus[status])
          return (
            <div
              key={col.id}
              style={{
                width: 220,
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 0,
              }}
            >
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 8,
              }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {col.label}
                </span>
                <span style={{ fontSize: 10, color: 'var(--fg-muted)', background: 'var(--bg-element)', borderRadius: 10, padding: '1px 6px' }}>
                  {colTickets.length}
                </span>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', paddingRight: 2 }}>
                {colTickets.map((t) => (
                  <TicketCard
                    key={t.id}
                    ticket={t}
                    selected={t.id === selectedId}
                    onClick={loadDetail}
                  />
                ))}
                {colTickets.length === 0 && (
                  <div style={{ fontSize: 11, color: 'var(--fg-muted)', padding: '4px 2px' }}>—</div>
                )}
              </div>
            </div>
          )
        })}
        <div style={{ marginLeft: 'auto', alignSelf: 'flex-start' }}>
          <button
            onClick={refresh}
            style={{ background: 'transparent', border: 'none', color: 'var(--fg-muted)', cursor: 'pointer', fontSize: 14, padding: 4 }}
            title="Refresh"
          >
            ↺
          </button>
        </div>
      </div>
      {/* Detail panel */}
      <div style={{
        width: 320,
        flexShrink: 0,
        borderLeft: '1px solid var(--border)',
        overflowY: 'auto',
      }}>
        <TicketDetail
          ticket={detail}
          loading={detailLoading}
          onStart={start}
          onHandoff={handoff}
          onLog={log}
        />
      </div>
    </div>
  )
}

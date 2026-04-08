import { useCallback, useEffect, useState } from 'react'
import type { MessageRecord } from '../electronAPI'
import { AppConfig, Session } from '../types'
import { mockMessages } from '../mockData'

export interface SessionDetailResult {
  messages: MessageRecord[]
  loading: boolean
  error: string | null
  /**
   * Set when conversation replay is intentionally unavailable for this
   * session (e.g. monitor-only claude-code sessions). Rendered by the
   * Context Panel as a muted empty-state rather than an error.
   */
  unavailable: string | null
  refresh: () => void
}

/**
 * Fetch full message history for a session. Refetches whenever the session's
 * lastActivity timestamp changes (driven by snapshot pushes from main), so
 * the conversation stays live without needing a separate per-session stream.
 *
 * In mock mode: returns a static fixture keyed by sessionId.
 */
export function useSessionDetail(
  session: Session | null,
  config: AppConfig | null
): SessionDetailResult {
  const useMock = config?.mock.enabled ?? true
  const sessionId = session?.id ?? null
  const agentType = session?.agentType ?? null
  const lastActivity = session?.lastActivity ?? 0

  const [messages, setMessages] = useState<MessageRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (!sessionId) {
      setMessages([])
      setError(null)
      setUnavailable(null)
      setLoading(false)
      return
    }

    // Claude Code sessions are monitor-only: agentctl observes their state
    // from ~/.claude/sessions/ but has no client that owns them, so the
    // opencode:session:messages IPC path is meaningless and would throw.
    // Short-circuit to a friendly empty state instead of hitting IPC.
    if (agentType === 'claude-code') {
      setMessages([])
      setError(null)
      setUnavailable('Monitor-only — conversation replay is not available for claude-code sessions.')
      setLoading(false)
      return
    }

    if (useMock) {
      setMessages(mockMessages(sessionId))
      setError(null)
      setUnavailable(null)
      setLoading(false)
      return
    }

    // Clear monitor-only state from any previous session.
    setUnavailable(null)

    const api = window.electronAPI?.opencode
    if (!api) {
      setError('preload bridge unavailable')
      setLoading(false)
      return
    }

    let disposed = false
    // Debounce: a busy session bumps lastActivity on every token part, so
    // naive refetching produces N+1 hammering of session.messages. Delay
    // the fetch by 300ms; rapid successive activity bumps coalesce into
    // one request. The first fetch on a fresh session runs immediately.
    const delay = nonce === 0 && messages.length === 0 ? 0 : 300
    const timer = setTimeout(() => {
      if (disposed) return
      setLoading(true)
      api
        .getMessages(sessionId)
        .then((msgs) => {
          if (disposed) return
          setMessages(msgs)
          setError(null)
        })
        .catch((err: unknown) => {
          if (disposed) return
          setError(err instanceof Error ? err.message : String(err))
        })
        .finally(() => {
          if (!disposed) setLoading(false)
        })
    }, delay)

    return () => {
      disposed = true
      clearTimeout(timer)
    }
    // Refetch when session identity changes, when activity advances (live
    // push signal), when mock mode flips, or on manual refresh.
    // messages intentionally excluded to avoid refetch loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, agentType, lastActivity, useMock, nonce])

  return { messages, loading, error, unavailable, refresh }
}

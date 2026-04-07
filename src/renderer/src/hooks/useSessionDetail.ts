import { useCallback, useEffect, useState } from 'react'
import type { MessageRecord } from '../electronAPI'
import { AppConfig, Session } from '../types'
import { mockMessages } from '../mockData'

export interface SessionDetailResult {
  messages: MessageRecord[]
  loading: boolean
  error: string | null
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
  const lastActivity = session?.lastActivity ?? 0

  const [messages, setMessages] = useState<MessageRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (!sessionId) {
      setMessages([])
      setError(null)
      setLoading(false)
      return
    }

    if (useMock) {
      setMessages(mockMessages(sessionId))
      setError(null)
      setLoading(false)
      return
    }

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
  }, [sessionId, lastActivity, useMock, nonce])

  return { messages, loading, error, refresh }
}

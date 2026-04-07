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
      return
    }

    if (useMock) {
      setMessages(mockMessages(sessionId))
      setError(null)
      return
    }

    const api = window.electronAPI?.opencode
    if (!api) {
      setError('preload bridge unavailable')
      return
    }

    let disposed = false
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

    return () => {
      disposed = true
    }
    // Refetch when session identity changes, when activity advances (live
    // push signal), when mock mode flips, or on manual refresh.
  }, [sessionId, lastActivity, useMock, nonce])

  return { messages, loading, error, refresh }
}

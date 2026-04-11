import { useState, useEffect } from 'react'
import type { OpencodeSnapshotPayload } from '@shared/types'
import { getSnapshot, subscribeSSE } from '../api'

export function useSnapshot(): { data: OpencodeSnapshotPayload | null; error: string | null } {
  const [data, setData] = useState<OpencodeSnapshotPayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Initial fetch
    getSnapshot().then(setData).catch((e: unknown) => setError(String(e)))

    // SSE subscription
    const unsub = subscribeSSE((snap) => { setData(snap); setError(null) })
    return unsub
  }, [])

  return { data, error }
}

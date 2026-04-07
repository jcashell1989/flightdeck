import { useEffect, useState } from 'react'

/**
 * Re-renders the calling component every `intervalMs` (default 1s) so that
 * derived values like `Date.now() - session.startedAt` stay fresh.
 * Returns the current `Date.now()` value.
 */
export function useElapsedTick(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

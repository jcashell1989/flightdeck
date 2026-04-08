import { useEffect, useState } from 'react'

/**
 * Re-renders the calling component every ~1s so that derived values like
 * `Date.now() - session.startedAt` stay fresh. All subscribers share a
 * single setInterval + a single `Date.now()` read per tick, so rendering
 * N SessionCards no longer costs N timers and N setStates per second.
 */
const subscribers = new Set<(now: number) => void>()
let sharedTimer: ReturnType<typeof setInterval> | null = null

function ensureTimer(): void {
  if (sharedTimer) return
  sharedTimer = setInterval(() => {
    const now = Date.now()
    for (const cb of subscribers) cb(now)
  }, 1000)
}

function maybeStopTimer(): void {
  if (subscribers.size === 0 && sharedTimer) {
    clearInterval(sharedTimer)
    sharedTimer = null
  }
}

export function useElapsedTick(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    subscribers.add(setNow)
    ensureTimer()
    return () => {
      subscribers.delete(setNow)
      maybeStopTimer()
    }
  }, [])
  return now
}

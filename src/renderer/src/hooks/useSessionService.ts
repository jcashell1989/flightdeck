import { useEffect, useMemo, useState } from 'react'
import { Project, ConnectionStatus, AppConfig, Session } from '../types'
import { mockProjects } from '../mockData'

function basename(path: string): string {
  const stripped = path.replace(/\/+$/, '')
  const i = stripped.lastIndexOf('/')
  return i === -1 ? stripped : stripped.slice(i + 1)
}

/**
 * Merge config-declared projects into the live snapshot list. A config
 * project is only surfaced if it isn't already present (by path) in the
 * snapshot — otherwise the live entry (with its sessions) wins. Archived
 * config projects are hidden from the dashboard and dispatch targets.
 */
function mergeConfigProjects(
  live: Project[],
  config: AppConfig | null
): Project[] {
  if (!config) return live
  const seen = new Set(live.map((p) => p.path))
  const extras: Project[] = []
  for (const cp of config.projects) {
    if (cp.archived) continue
    if (seen.has(cp.path)) continue
    extras.push({
      id: `config:${cp.path}`,
      name: cp.name ?? basename(cp.path),
      path: cp.path,
      sessions: []
    })
  }
  return extras.length === 0 ? live : [...live, ...extras]
}

export interface SessionServiceResult {
  projects: Project[]
  connectionStatus: ConnectionStatus
  error: string | null
}

/**
 * Source-of-truth for the dashboard's project/session data.
 *
 * - If config.mock.enabled: returns the local fixture. No IPC.
 * - Otherwise: subscribes to main-process opencode snapshots via IPC.
 *
 * Subscription order matters: we register the push listener BEFORE invoking
 * getSnapshot() so a push that fires while the initial fetch is in flight
 * cannot be overwritten by the older snapshot. We also track a monotonic
 * sequence counter so a late-arriving initial fetch can never clobber a
 * fresher push that has already been applied (B2 in code review).
 */
export function useSessionService(config: AppConfig | null): SessionServiceResult {
  const useMock = config?.mock.enabled ?? true

  const [liveProjects, setLiveProjects] = useState<Project[]>([])
  const [liveStatus, setLiveStatus] = useState<ConnectionStatus>('connecting')
  const [liveError, setLiveError] = useState<string | null>(null)

  useEffect(() => {
    if (useMock) return
    const api = window.electronAPI?.opencode
    if (!api) {
      setLiveStatus('error')
      setLiveError('preload bridge unavailable')
      return
    }

    let disposed = false
    // Any push applied is tracked so a late-arriving initial fetch (seq 0)
    // cannot overwrite a fresher push that already landed. Pushes always
    // win over the initial fetch because we bump pushSeq BEFORE apply and
    // use <= for the staleness check.
    let lastAppliedSeq = -1
    let pushSeq = 0

    const apply = (
      snap: {
        projects: Project[]
        aggregateStatus: {
          status: ConnectionStatus
          perInstance: Array<{ key: string; status: string; lastError: string | null }>
        }
      },
      seq: number
    ): void => {
      if (disposed) return
      if (seq <= lastAppliedSeq) return
      lastAppliedSeq = seq
      setLiveProjects(snap.projects)
      setLiveStatus(snap.aggregateStatus.status)
      const firstErr = snap.aggregateStatus.perInstance.find((i) => i.lastError)?.lastError
      setLiveError(firstErr ?? null)
    }

    // Subscribe FIRST so we don't miss events fired between the fetch and
    // its resolution. Pushes start at seq 1; initial fetch is seq 0 so it
    // only applies if no push has landed yet.
    const unsub = api.onSnapshot((snap) => {
      pushSeq += 1
      apply(snap, pushSeq)
    })
    api.getSnapshot().then((snap) => apply(snap, 0))

    const unsubStream = api.onStreamUpdate?.((update) => {
      if (disposed) return
      setLiveProjects((prev) =>
        prev.map((p) => ({
          ...p,
          sessions: p.sessions.map((s) =>
            s.id === update.sessionId
              ? { ...s, currentAction: update.currentAction, state: update.state as Session['state'] }
              : s
          )
        }))
      )
    })

    return () => {
      disposed = true
      unsub()
      unsubStream?.()
    }
  }, [useMock])

  const mergedProjects = useMemo(
    () => mergeConfigProjects(liveProjects, config),
    [liveProjects, config]
  )

  if (useMock) {
    return { projects: mockProjects, connectionStatus: 'disabled', error: null }
  }
  return { projects: mergedProjects, connectionStatus: liveStatus, error: liveError }
}

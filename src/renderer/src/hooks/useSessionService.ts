import { useEffect, useState } from 'react'
import { Project, ConnectionStatus, AppConfig } from '../types'
import { mockProjects } from '../mockData'

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
 * Slice 4: live branch is fully wired. The main-process registry hydrates
 * on start and pushes via `opencode:snapshot` whenever state mutates.
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
    const apply = (snap: {
      projects: Project[]
      aggregateStatus: {
        status: ConnectionStatus
        perInstance: Array<{ key: string; status: string; lastError: string | null }>
      }
    }): void => {
      if (disposed) return
      setLiveProjects(snap.projects)
      setLiveStatus(snap.aggregateStatus.status)
      const firstErr = snap.aggregateStatus.perInstance.find((i) => i.lastError)?.lastError
      setLiveError(firstErr ?? null)
    }

    api.getSnapshot().then(apply)
    const unsub = api.onSnapshot(apply)
    return () => {
      disposed = true
      unsub()
    }
  }, [useMock])

  if (useMock) {
    return { projects: mockProjects, connectionStatus: 'disabled', error: null }
  }
  return { projects: liveProjects, connectionStatus: liveStatus, error: liveError }
}

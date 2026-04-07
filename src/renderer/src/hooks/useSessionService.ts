import { useMemo } from 'react'
import { Project, ConnectionStatus, AppConfig } from '../types'
import { mockProjects } from '../mockData'

export interface SessionServiceResult {
  projects: Project[]
  connectionStatus: ConnectionStatus
  error: string | null
}

/**
 * Phase 2 Slice 2: only the mock branch is wired.
 * Slice 4 will add the live IPC branch.
 */
export function useSessionService(config: AppConfig | null): SessionServiceResult {
  const useMock = config?.mock.enabled ?? true

  return useMemo<SessionServiceResult>(() => {
    if (useMock) {
      return { projects: mockProjects, connectionStatus: 'disabled', error: null }
    }
    // Live branch placeholder — implemented in Slice 4.
    return { projects: [], connectionStatus: 'connecting', error: null }
  }, [useMock])
}

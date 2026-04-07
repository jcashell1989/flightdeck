/**
 * Internal types for the main-process opencode integration layer.
 *
 * These are intentionally separate from the renderer's Session/Project types
 * in src/renderer/src/types.ts — the mapper translates between them.
 */
import type { OpencodeInstance } from '../config/store'

export type NormalizedSessionState =
  | 'running'
  | 'idle'
  | 'approval'
  | 'question'
  | 'error'

export interface NormalizedSession {
  id: string
  agentType: 'opencode'
  state: NormalizedSessionState
  currentAction: string
  startedAt: number
  lastActivity: number
  projectId: string
}

export interface NormalizedProject {
  id: string
  name: string
  path: string
  sessions: NormalizedSession[]
}

export type InstanceConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error'

export interface InstanceSnapshot {
  instance: OpencodeInstance
  status: InstanceConnectionStatus
  lastError: string | null
  projects: NormalizedProject[]
}

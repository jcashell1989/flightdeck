/**
 * Shared types for the adapter layer.
 *
 * Each adapter implements the Adapter interface and registers with AdapterRegistry.
 * The registry merges their snapshots into a single AggregateSnapshot.
 */
import type { NormalizedProject, InstanceConnectionStatus } from '../opencode/types'

export type { InstanceConnectionStatus }

// Re-export from opencode/types for adapters that need it
export type { NormalizedProject }

export type AggregateStatus = {
  status: InstanceConnectionStatus | 'disabled'
  perInstance: Array<{ key: string; status: InstanceConnectionStatus; lastError: string | null }>
}

export type AggregateSnapshot = {
  projects: NormalizedProject[]
  aggregateStatus: AggregateStatus
}

export type AdapterSnapshot = {
  projects: NormalizedProject[]
  status: InstanceConnectionStatus | 'disabled'
  perInstance: Array<{ key: string; status: InstanceConnectionStatus; lastError: string | null }>
}

export type DispatchRequest = {
  profileId: string
  directory: string
  prompt: string
  title?: string
  sessionId?: string
}

export type CommandDefinition = {
  name: string
  description: string
  source: string
  template?: string
}

export type ControlMode = 'managed' | 'watched'

export interface Adapter {
  id: string
  label: string
  canDispatch: boolean

  start(): void
  dispose(): void
  snapshot(): AdapterSnapshot

  // EventEmitter subset — all adapters extend EventEmitter
  on(event: string, listener: (...args: unknown[]) => void): this
  off(event: string, listener: (...args: unknown[]) => void): this
  emit(event: string, ...args: unknown[]): boolean

  // Optional capabilities — presence indicates the adapter supports the operation.
  send?: (sessionId: string, text: string) => Promise<void>
  sendCommand?: (sessionId: string, command: string, args: string) => Promise<{ ok: boolean }>
  listCommands?: (sessionId: string) => Promise<CommandDefinition[]>
  abort?: (sessionId: string) => Promise<void>
  respondPermission?: (
    sessionId: string,
    permissionId: string,
    response: 'once' | 'always' | 'reject'
  ) => Promise<void>
  fetchMessages?: (
    sessionId: string
  ) => Promise<Array<{ info: unknown; parts: unknown[] }>>
  getSessionLog?: (sessionId: string) => string[]
  dispatch?: (req: DispatchRequest) => Promise<{ sessionId: string }>
}

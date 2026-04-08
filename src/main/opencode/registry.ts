/**
 * OpencodeRegistry — owns N OpencodeInstanceClients, keyed by host:port.
 *
 * Syncs with ConfigStore: when the opencode.instances list changes, adds
 * new clients, removes dropped ones, and rebuilds clients whose host/port
 * changed. Emits 'change' when the aggregate snapshot mutates.
 *
 * Also integrates with ClaudeMonitor (Phase 4): Claude Code sessions are
 * merged into the aggregate snapshot alongside opencode sessions.
 */
import { EventEmitter } from 'events'
import { OpencodeInstanceClient } from './client'
import { configStore, OpencodeInstance, AppConfig } from '../config/store'
import type { NormalizedProject, InstanceSnapshot, InstanceConnectionStatus } from './types'
import type { ClaudeMonitor } from '../claude/monitor'
import type { ClaudeProject } from '../claude/types'

function keyOf(inst: OpencodeInstance): string {
  return `${inst.host}:${inst.port}`
}

export interface AggregateStatus {
  status: InstanceConnectionStatus | 'disabled'
  perInstance: Array<{ key: string; status: InstanceConnectionStatus; lastError: string | null }>
}

export class OpencodeRegistry extends EventEmitter {
  private clients = new Map<string, OpencodeInstanceClient>()
  private disposed = false
  private claudeMonitor: ClaudeMonitor | null = null

  /** Wire in the Claude Code monitor. Call before start(). */
  setClaudeMonitor(monitor: ClaudeMonitor): void {
    this.claudeMonitor = monitor
    monitor.on('change', () => this.emit('change'))
  }

  start(): void {
    const cfg = configStore.get()
    this.sync(cfg)
    configStore.on('change', this.handleConfigChange)
  }

  dispose(): void {
    this.disposed = true
    configStore.off('change', this.handleConfigChange)
    for (const c of this.clients.values()) c.dispose()
    this.clients.clear()
    this.removeAllListeners()
  }

  /** Find the client that owns a given sessionId (linear scan — N is small). */
  findClientForSession(sessionId: string): OpencodeInstanceClient | null {
    for (const c of this.clients.values()) {
      if (c.hasSession(sessionId)) return c
    }
    return null
  }

  /** Find a client by its host:port key. */
  findClientByKey(key: string): OpencodeInstanceClient | null {
    return this.clients.get(key) ?? null
  }

  /** First client (used as a default target when no instanceKey is supplied). */
  firstClient(): OpencodeInstanceClient | null {
    const iter = this.clients.values().next()
    return iter.done ? null : iter.value
  }

  listClients(): Array<{ key: string; client: OpencodeInstanceClient }> {
    return Array.from(this.clients.entries()).map(([key, client]) => ({ key, client }))
  }

  snapshot(): { projects: NormalizedProject[]; aggregateStatus: AggregateStatus } {
    const projects: NormalizedProject[] = []
    const perInstance: AggregateStatus['perInstance'] = []
    for (const [key, client] of this.clients) {
      const s: InstanceSnapshot = client.snapshot()
      projects.push(...s.projects)
      perInstance.push({ key, status: s.status, lastError: s.lastError })
    }

    // Merge Claude Code sessions into the project list.
    if (this.claudeMonitor) {
      const claudeSnap = this.claudeMonitor.getSnapshot()
      for (const claudeProject of claudeSnap.projects) {
        this.mergeClaudeProject(projects, claudeProject)
      }
    }

    return {
      projects,
      aggregateStatus: {
        status: this.deriveAggregate(perInstance),
        perInstance
      }
    }
  }

  /**
   * Merge a Claude Code project into the opencode project list.
   * If a project with the same path already exists, append Claude Code sessions
   * to it. Otherwise, create a new project entry.
   */
  private mergeClaudeProject(
    projects: NormalizedProject[],
    claudeProject: ClaudeProject
  ): void {
    const existing = projects.find((p) => p.path === claudeProject.path)
    const claudeSessions = claudeProject.sessions.map((s) => ({
      id: s.sessionId,
      agentType: 'claude-code' as const,
      state: s.state as 'running' | 'idle' | 'error',
      currentAction: s.currentAction,
      startedAt: s.startedAt,
      lastActivity: s.lastActivity,
      projectId: claudeProject.path,
      instanceKey: `claude:${s.pid}`,
      pendingPermission: null
    }))

    if (existing) {
      existing.sessions.push(...claudeSessions)
    } else {
      projects.push({
        id: claudeProject.path,
        name: claudeProject.name,
        path: claudeProject.path,
        sessions: claudeSessions
      })
    }
  }

  private deriveAggregate(
    perInstance: AggregateStatus['perInstance']
  ): AggregateStatus['status'] {
    // Worst-of-N precedence: error > reconnecting > connecting > connected.
    // Errors must not be hidden by another instance that happens to be
    // reconnecting (S2 in code review).
    if (perInstance.length === 0) return 'disabled'
    if (perInstance.some((i) => i.status === 'error')) return 'error'
    if (perInstance.some((i) => i.status === 'reconnecting')) return 'reconnecting'
    if (perInstance.some((i) => i.status === 'connecting')) return 'connecting'
    return 'connected'
  }

  private handleConfigChange = (cfg: AppConfig): void => {
    if (this.disposed) return
    this.sync(cfg)
  }

  private sync(cfg: AppConfig): void {
    const mockMode = cfg.mock.enabled
    // When mock mode is on, tear down all live connections.
    if (mockMode) {
      for (const c of this.clients.values()) c.dispose()
      this.clients.clear()
      this.emit('change')
      return
    }

    const desired = new Map<string, OpencodeInstance>()
    for (const inst of cfg.opencode.instances) desired.set(keyOf(inst), inst)

    // Remove clients that are no longer desired.
    for (const [key, client] of this.clients) {
      if (!desired.has(key)) {
        client.dispose()
        this.clients.delete(key)
      }
    }

    // Add missing clients.
    for (const [key, inst] of desired) {
      if (!this.clients.has(key)) {
        const client = new OpencodeInstanceClient(inst)
        client.on('change', () => this.emit('change'))
        client.on('status', () => this.emit('change'))
        this.clients.set(key, client)
        void client.connect()
      }
    }

    this.emit('change')
  }
}

export const opencodeRegistry = new OpencodeRegistry()

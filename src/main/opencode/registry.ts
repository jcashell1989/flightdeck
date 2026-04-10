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
  // Cache for claudeMonitor.getSnapshot() — invalidated on each 'change' event
  // so we avoid re-iterating all Claude sessions on every aggregate snapshot call.
  private _claudeSnapCache: ReturnType<ClaudeMonitor['getSnapshot']> | null = null
  private _claudeSnapDirty = true
  /**
   * Serialises sync() calls. Rapid back-to-back config changes (e.g. the
   * user mashing "save" in Settings) used to race and leak clients because
   * the second pass could overwrite a map entry while the first pass was
   * still constructing the previous one. All sync() callers now chain onto
   * this promise.
   */
  private syncChain: Promise<void> = Promise.resolve()

  /** Wire in the Claude Code monitor. Call before start(). */
  setClaudeMonitor(monitor: ClaudeMonitor): void {
    this.claudeMonitor = monitor
    monitor.on('change', () => {
      this._claudeSnapDirty = true
      this.emit('change')
    })
  }

  start(): void {
    const cfg = configStore.get()
    // First sync runs synchronously so start() returning implies clients are
    // constructed. Subsequent syncs (triggered by config-change events) go
    // through enqueueSync which serialises them.
    this.sync(cfg)
    configStore.on('change', this.handleConfigChange)
  }

  private enqueueSync(cfg: AppConfig): void {
    this.syncChain = this.syncChain
      .then(() => {
        if (this.disposed) return
        return this.sync(cfg)
      })
      .catch((err) => {
        console.error('[OpencodeRegistry] sync failed:', err)
      })
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

  /**
   * Ensure a client exists and is connected for a managed (launcher-spawned)
   * instance. The key is `managed:${profileId}:${directory}` to avoid
   * colliding with manually-configured host:port keys.
   *
   * If a client already exists for this key, returns it immediately.
   * Otherwise creates a new client, registers it, and starts connecting.
   */
  ensureManagedClient(
    instance: OpencodeInstance,
    managedKey: string
  ): OpencodeInstanceClient {
    const existing = this.clients.get(managedKey)
    if (existing) return existing

    const client = new OpencodeInstanceClient(instance, managedKey)
    client.on('change', () => this.emit('change'))
    client.on('status', () => this.emit('change'))
    this.clients.set(managedKey, client)
    void client.connect()
    return client
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
    // Use cached snapshot to avoid re-iterating all sessions on every poll cycle.
    if (this.claudeMonitor) {
      if (this._claudeSnapDirty || !this._claudeSnapCache) {
        this._claudeSnapCache = this.claudeMonitor.getSnapshot()
        this._claudeSnapDirty = false
      }
      for (const claudeProject of this._claudeSnapCache.projects) {
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
    this.enqueueSync(cfg)
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

    // Add missing clients. Pass the map key as the clientKey so managed and
    // configured instances on the same host:port never produce colliding
    // projectIds in snapshots.
    for (const [key, inst] of desired) {
      if (!this.clients.has(key)) {
        const client = new OpencodeInstanceClient(inst, key)
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

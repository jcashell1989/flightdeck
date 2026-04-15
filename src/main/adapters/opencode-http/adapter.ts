/**
 * OpencodeHttpAdapter — wraps OpencodeRegistry's opencode HTTP client logic.
 *
 * Implements the Adapter interface. canDispatch = true.
 * Manages N OpencodeInstanceClients keyed by host:port or managed:profileId:directory.
 * Handles config-driven sync (add/remove instances when AppConfig changes).
 */
import { EventEmitter } from 'events'
import { OpencodeInstanceClient } from './client'
import { configStore, OpencodeInstance, AppConfig } from '../../config/store'
import type { Adapter, AdapterSnapshot, DispatchRequest, CommandDefinition } from '../types'
import type { NormalizedProject } from './types'
import { waitForClientConnected } from '../../util/shell'
import { OpencodeLauncher } from './launcher'

function keyOf(inst: OpencodeInstance): string {
  return `${inst.host}:${inst.port}`
}

export class OpencodeHttpAdapter extends EventEmitter implements Adapter {
  readonly id = 'opencode-http'
  readonly label = 'OpencodeHTTP'
  readonly canDispatch = true

  private clients = new Map<string, OpencodeInstanceClient>()
  private disposed = false
  private launcher = new OpencodeLauncher()
  private syncChain: Promise<void> = Promise.resolve()

  start(): void {
    const cfg = configStore.get()
    if (cfg.mock.enabled) return
    this.sync(cfg)
    configStore.on('change', this.handleConfigChange)
  }

  dispose(): void {
    this.disposed = true
    configStore.off('change', this.handleConfigChange)
    for (const c of this.clients.values()) c.dispose()
    this.clients.clear()
    void this.launcher.stopAllAsync()
    this.removeAllListeners()
  }

  snapshot(): AdapterSnapshot {
    const projects: NormalizedProject[] = []
    const perInstance: AdapterSnapshot['perInstance'] = []

    for (const [key, client] of this.clients) {
      const s = client.snapshot()
      if (key.startsWith('managed:')) {
        // Managed clients: only surface sessions created after this client was
        // constructed, scoped to the target directory.
        const clientCreatedAt = client.createdAt
        const targetDir = key.split(':').slice(2).join(':')
        for (const mp of s.projects.filter((p) => p.path === targetDir)) {
          const ownedSessions = mp.sessions.filter((ses) => ses.startedAt >= clientCreatedAt)
          if (ownedSessions.length === 0) continue
          const owned = { ...mp, sessions: ownedSessions }
          const existing = projects.find((p) => p.path === owned.path)
          if (existing) {
            const existingIds = new Set(existing.sessions.map((ses) => ses.id))
            existing.sessions.push(...owned.sessions.filter((ses) => !existingIds.has(ses.id)))
          } else {
            projects.push(owned)
          }
        }
      } else {
        projects.push(...s.projects)
      }
      perInstance.push({ key, status: s.status, lastError: s.lastError })
    }

    return {
      projects,
      status: this.deriveStatus(perInstance),
      perInstance
    }
  }

  async send(sessionId: string, text: string): Promise<void> {
    const client = this.findClientForSession(sessionId)
    if (!client) throw new Error(`no client owns session ${sessionId}`)
    await client.sendPrompt(sessionId, text)
  }

  async sendCommand(sessionId: string, command: string, args: string): Promise<{ ok: boolean }> {
    const client = this.findClientForSession(sessionId)
    if (!client) throw new Error(`no client owns session ${sessionId}`)
    return client.postCommand(sessionId, command, args)
  }

  async listCommands(sessionId: string): Promise<CommandDefinition[]> {
    const client = this.findClientForSession(sessionId)
    if (!client) return []
    return client.listCommands()
  }

  async abort(sessionId: string): Promise<void> {
    const client = this.findClientForSession(sessionId)
    if (!client) throw new Error(`no client owns session ${sessionId}`)
    await client.abortSession(sessionId)
  }

  async respondPermission(
    sessionId: string,
    permissionId: string,
    response: 'once' | 'always' | 'reject'
  ): Promise<void> {
    const client = this.findClientForSession(sessionId)
    if (!client) throw new Error(`no client owns session ${sessionId}`)
    await client.respondPermission(sessionId, permissionId, response)
  }

  async fetchMessages(sessionId: string): Promise<Array<{ info: unknown; parts: unknown[] }>> {
    const client = this.findClientForSession(sessionId)
    if (!client) return []
    return client.fetchMessages(sessionId)
  }

  async dispatch(req: DispatchRequest): Promise<{ sessionId: string }> {
    const cfg = configStore.get()
    const profile = cfg.profiles.find((p) => p.id === req.profileId)
    if (!profile) throw new Error(`profile ${req.profileId} not found`)

    if (profile.agentType !== 'opencode') {
      throw new Error(`OpencodeHttpAdapter cannot dispatch for agentType: ${profile.agentType}`)
    }

    const port = await this.launcher.launch(profile, req.directory)
    const managedKey = `managed:${req.profileId}:${req.directory}`
    const client = this.ensureManagedClient({ host: '127.0.0.1', port, label: profile.label }, managedKey)
    await waitForClientConnected(client)

    let sessionId: string
    if (req.sessionId) {
      // Append to existing session.
      await client.sendPrompt(req.sessionId, req.prompt)
      sessionId = req.sessionId
    } else {
      sessionId = await client.createSession(req.directory, req.title)
      await client.sendPrompt(sessionId, req.prompt)
    }
    return { sessionId }
  }

  // ── Internal helpers ────────────────────────────────────────────────────

  ensureManagedClient(instance: OpencodeInstance, managedKey: string): OpencodeInstanceClient {
    const existing = this.clients.get(managedKey)
    if (existing) return existing
    const client = new OpencodeInstanceClient(instance, managedKey)
    client.on('change', () => this.emit('change'))
    client.on('status', () => this.emit('change'))
    this.clients.set(managedKey, client)
    void client.connect()
    return client
  }

  findClientForSession(sessionId: string): OpencodeInstanceClient | null {
    for (const c of this.clients.values()) {
      if (c.hasSession(sessionId)) return c
    }
    return null
  }

  findClientByKey(key: string): OpencodeInstanceClient | null {
    return this.clients.get(key) ?? null
  }

  firstClient(): OpencodeInstanceClient | null {
    const iter = this.clients.values().next()
    return iter.done ? null : iter.value
  }

  getLauncher(): OpencodeLauncher {
    return this.launcher
  }

  private deriveStatus(perInstance: AdapterSnapshot['perInstance']): AdapterSnapshot['status'] {
    if (perInstance.length === 0) return 'disabled'
    if (perInstance.some((i) => i.status === 'error')) return 'error'
    if (perInstance.some((i) => i.status === 'reconnecting')) return 'reconnecting'
    if (perInstance.some((i) => i.status === 'connecting')) return 'connecting'
    return 'connected'
  }

  private handleConfigChange = (cfg: AppConfig): void => {
    if (this.disposed) return
    this.syncChain = this.syncChain
      .then(() => {
        if (this.disposed) return
        return this.sync(cfg)
      })
      .catch((err) => {
        console.error('[OpencodeHttpAdapter] sync failed:', err)
      })
  }

  private sync(cfg: AppConfig): void {
    if (cfg.mock.enabled) {
      for (const c of this.clients.values()) c.dispose()
      this.clients.clear()
      this.emit('change')
      return
    }

    const desired = new Map<string, OpencodeInstance>()
    for (const inst of cfg.opencode.instances) desired.set(keyOf(inst), inst)

    // Remove clients that are no longer desired (skip managed: keys).
    for (const [key, client] of this.clients) {
      if (!key.startsWith('managed:') && !desired.has(key)) {
        client.dispose()
        this.clients.delete(key)
      }
    }

    // Add missing configured clients.
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

export const opencodeHttpAdapter = new OpencodeHttpAdapter()

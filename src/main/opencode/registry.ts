/**
 * OpencodeRegistry — owns N OpencodeInstanceClients, keyed by host:port.
 *
 * Syncs with ConfigStore: when the opencode.instances list changes, adds
 * new clients, removes dropped ones, and rebuilds clients whose host/port
 * changed. Emits 'change' when the aggregate snapshot mutates.
 */
import { EventEmitter } from 'events'
import { OpencodeInstanceClient } from './client'
import { configStore, OpencodeInstance, AppConfig } from '../config/store'
import type { NormalizedProject, InstanceSnapshot, InstanceConnectionStatus } from './types'

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

  snapshot(): { projects: NormalizedProject[]; aggregateStatus: AggregateStatus } {
    const projects: NormalizedProject[] = []
    const perInstance: AggregateStatus['perInstance'] = []
    for (const [key, client] of this.clients) {
      const s: InstanceSnapshot = client.snapshot()
      projects.push(...s.projects)
      perInstance.push({ key, status: s.status, lastError: s.lastError })
    }
    return {
      projects,
      aggregateStatus: {
        status: this.deriveAggregate(perInstance),
        perInstance
      }
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

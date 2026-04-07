/**
 * OpencodeInstanceClient — connects to one `opencode serve` instance.
 *
 * Responsibilities:
 * - Hydrate initial state via client.session.list() + client.session.status().
 * - Subscribe to `${baseUrl}/event` SSE stream.
 * - Apply incoming events via the pure mapper.
 * - Emit 'change' when the snapshot mutates and 'status' when connection
 *   state changes.
 * - Reconnect with exponential backoff (1s → 30s cap) on network error.
 */
import { EventEmitter } from 'events'
import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk'
import { EventSource } from 'eventsource'
import type { OpencodeInstance } from '../config/store'
import {
  InternalSessionState,
  applyEvent,
  groupIntoProjects,
  initialSessionState
} from './mapper'
import type { InstanceConnectionStatus, InstanceSnapshot } from './types'

const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000]

export class OpencodeInstanceClient extends EventEmitter {
  private sdk: OpencodeClient
  private baseUrl: string
  private es: EventSource | null = null
  private sessions = new Map<string, InternalSessionState>()
  private status: InstanceConnectionStatus = 'connecting'
  private lastError: string | null = null
  private reconnectAttempt = 0
  private reconnectTimer: NodeJS.Timeout | null = null
  private disposed = false

  constructor(public readonly instance: OpencodeInstance) {
    super()
    this.baseUrl = `http://${instance.host}:${instance.port}`
    this.sdk = createOpencodeClient({ baseUrl: this.baseUrl })
  }

  async connect(): Promise<void> {
    if (this.disposed) return
    this.setStatus('connecting')
    try {
      await this.hydrate()
      this.openEventStream()
      this.reconnectAttempt = 0
      this.setStatus('connected')
      this.emit('change', this.snapshot())
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err)
      this.setStatus('error')
      this.scheduleReconnect()
    }
  }

  dispose(): void {
    this.disposed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.es) {
      this.es.close()
      this.es = null
    }
    this.removeAllListeners()
  }

  snapshot(): InstanceSnapshot {
    return {
      instance: this.instance,
      status: this.status,
      lastError: this.lastError,
      projects: groupIntoProjects(this.sessions.values(), this.instance)
    }
  }

  private async hydrate(): Promise<void> {
    const listRes = await this.sdk.session.list()
    const list = listRes.data ?? []
    this.sessions.clear()
    for (const meta of list) {
      this.sessions.set(meta.id, initialSessionState(meta))
    }
    try {
      const statusRes = await this.sdk.session.status()
      const statuses = statusRes.data ?? {}
      for (const [id, sdkStatus] of Object.entries(statuses)) {
        const s = this.sessions.get(id)
        if (s) s.sdkStatus = sdkStatus
      }
    } catch {
      // session.status is a convenience — if it fails, we still have list
    }
  }

  private openEventStream(): void {
    if (this.es) {
      this.es.close()
      this.es = null
    }
    const url = `${this.baseUrl}/event`
    const es = new EventSource(url)
    this.es = es

    es.onmessage = (ev: MessageEvent): void => {
      try {
        const event = JSON.parse(ev.data)
        const mutated = applyEvent(this.sessions, event)
        if (mutated) this.emit('change', this.snapshot())
      } catch (err) {
        console.error('[opencode] failed to parse event', err)
      }
    }

    es.onerror = (): void => {
      if (this.disposed) return
      // EventSource's built-in reconnect is unreliable against a dead server;
      // take over manually.
      if (this.es) {
        this.es.close()
        this.es = null
      }
      this.setStatus('reconnecting')
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) return
    const delay = BACKOFF_MS[Math.min(this.reconnectAttempt, BACKOFF_MS.length - 1)]
    this.reconnectAttempt++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.disposed) void this.connect()
    }, delay)
  }

  private setStatus(next: InstanceConnectionStatus): void {
    if (this.status === next) return
    this.status = next
    this.emit('status', { instance: this.instance, status: next, lastError: this.lastError })
  }
}

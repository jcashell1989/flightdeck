/**
 * OpencodeInstanceClient — connects to one `opencode serve` instance.
 *
 * Lifecycle:
 * - openEventStream() first, with events queued into a buffer.
 * - hydrate() snapshots session.list() / session.status().
 * - Buffered events are then replayed against the hydrated state, so we
 *   never lose an event that arrived during the hydrate window (S1).
 * - Subsequent events apply directly.
 *
 * Reconnect: exponential backoff (1s → 30s cap) on EventSource error or
 * hydrate failure. The `eventsource` lib's built-in reconnect is unreliable
 * against a fully-down server, so we manage it ourselves.
 */
import { EventEmitter } from 'events'
import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk'
import { EventSource } from 'eventsource'
import type { Event as SdkEvent } from '@opencode-ai/sdk'
import type { OpencodeInstance } from '../config/store'
import {
  InternalSessionState,
  applyEvent,
  groupIntoProjects,
  initialSessionState
} from './mapper'
import type { InstanceConnectionStatus, InstanceSnapshot } from './types'

const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000]

// Known opencode event types — used to register named SSE listeners as a
// defensive fallback in case the server emits `event: <type>\ndata: ...`
// rather than the default `message` event we listen on via onmessage.
const KNOWN_EVENT_TYPES = [
  'session.updated',
  'session.deleted',
  'session.status',
  'session.idle',
  'session.error',
  'permission.updated',
  'permission.replied',
  'message.part.updated'
] as const

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
  // Buffer for events that arrive between openEventStream() and hydrate()
  // completion. While non-null, applyEvent is deferred.
  private eventBuffer: SdkEvent[] | null = null

  constructor(public readonly instance: OpencodeInstance) {
    super()
    this.baseUrl = `http://${instance.host}:${instance.port}`
    this.sdk = createOpencodeClient({ baseUrl: this.baseUrl })
  }

  async connect(): Promise<void> {
    if (this.disposed) return
    this.setStatus('connecting')
    this.eventBuffer = []
    try {
      this.openEventStream()
      await this.hydrate()
      // Drain the buffer before going live. Any frames that arrive during
      // drain are still buffered (eventBuffer !== null), so they get picked
      // up by the next loop iteration. Only after the buffer is fully empty
      // do we null it and let handleRawEvent take the direct-apply path.
      // This enforces replay-before-live ordering without relying on the
      // registry's incidental re-snapshot behavior.
      while (this.eventBuffer && this.eventBuffer.length > 0) {
        const batch = this.eventBuffer
        this.eventBuffer = []
        for (const ev of batch) applyEvent(this.sessions, ev)
      }
      this.eventBuffer = null
      this.reconnectAttempt = 0
      this.setStatus('connected')
      this.emit('change', this.snapshot())
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err)
      this.eventBuffer = null
      if (this.es) {
        this.es.close()
        this.es = null
      }
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
    } catch (err) {
      // session.status is a convenience — if it fails, we still have list.
      // Surface a warning so reviewers see SDK shape drift instead of silent.
      console.warn('[opencode] session.status failed during hydrate:', err)
    }
  }

  private handleRawEvent(raw: string): void {
    try {
      const event = JSON.parse(raw) as SdkEvent
      if (this.eventBuffer) {
        this.eventBuffer.push(event)
        return
      }
      const mutated = applyEvent(this.sessions, event)
      if (mutated) this.emit('change', this.snapshot())
    } catch (err) {
      console.error('[opencode] failed to parse event', err)
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

    // Default `message` event — opencode's standard frame.
    es.onmessage = (ev: MessageEvent): void => this.handleRawEvent(ev.data)

    // Defensive: if the server emits `event: <type>\ndata: ...` (named SSE
    // events), onmessage will never fire. Register listeners for every
    // known type so the client is robust to either framing style.
    for (const type of KNOWN_EVENT_TYPES) {
      es.addEventListener(type, (ev: MessageEvent) => this.handleRawEvent(ev.data))
    }

    es.onerror = (): void => {
      if (this.disposed) return
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

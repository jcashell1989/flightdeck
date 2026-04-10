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
  // Named-event SSE listeners, kept so closeEventStream can detach them
  // before closing the underlying EventSource.
  private namedListeners = new Map<string, (ev: MessageEvent) => void>()

  /**
   * @param instance host/port/label tuple
   * @param clientKey the registry-level key identifying this client
   *                  (e.g. "127.0.0.1:4096" for configured instances, or
   *                  "managed:<profileId>:<directory>" for launcher-spawned
   *                  ones). Used to stamp projectId/instanceKey in snapshots
   *                  so managed and configured instances on the same
   *                  host:port do not collide in React keys.
   */
  constructor(
    public readonly instance: OpencodeInstance,
    public readonly clientKey: string = `${instance.host}:${instance.port}`
  ) {
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
      this.closeEventStream()
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
    this.closeEventStream()
    this.removeAllListeners()
  }

  snapshot(): InstanceSnapshot {
    return {
      instance: this.instance,
      status: this.status,
      lastError: this.lastError,
      projects: groupIntoProjects(this.sessions.values(), this.instance, this.clientKey)
    }
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  getDirectory(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.meta.directory
  }

  async fetchMessages(
    sessionId: string
  ): Promise<Array<{ info: unknown; parts: unknown[] }>> {
    const res = await this.sdk.session.messages({ path: { id: sessionId } })
    return (res.data ?? []) as Array<{ info: unknown; parts: unknown[] }>
  }

  async sendPrompt(sessionId: string, text: string): Promise<void> {
    const dir = this.getDirectory(sessionId)
    await this.sdk.session.prompt({
      path: { id: sessionId },
      query: dir ? { directory: dir } : undefined,
      body: {
        parts: [{ type: 'text', text }]
      }
    })
  }

  async respondPermission(
    sessionId: string,
    permissionId: string,
    response: 'once' | 'always' | 'reject'
  ): Promise<void> {
    const dir = this.getDirectory(sessionId)
    await this.sdk.postSessionIdPermissionsPermissionId({
      path: { id: sessionId, permissionID: permissionId },
      query: dir ? { directory: dir } : undefined,
      body: { response }
    })
  }

  async abortSession(sessionId: string): Promise<void> {
    const dir = this.getDirectory(sessionId)
    // SDK exposes session.abort in 1.3.17
    const anySdk = this.sdk.session as unknown as {
      abort?: (opts: {
        path: { id: string }
        query?: { directory?: string }
      }) => Promise<unknown>
    }
    if (typeof anySdk.abort === 'function') {
      await anySdk.abort({
        path: { id: sessionId },
        query: dir ? { directory: dir } : undefined
      })
    }
  }

  /** POST /session/:id/command — server-side slash command execution (td-3d1f6c) */
  async postCommand(sessionId: string, command: string, args: string): Promise<{ ok: boolean }> {
    const dir = this.getDirectory(sessionId)
    const url = new URL(`/session/${encodeURIComponent(sessionId)}/command`, this.baseUrl)
    if (dir) url.searchParams.set('directory', dir)
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, arguments: args })
    })
    if (!res.ok) throw new Error(`opencode command failed: ${res.status}`)
    return { ok: true }
  }

  /** GET /command — discover available slash commands for typeahead (td-3d1f6c) */
  async listCommands(): Promise<Array<{ name: string; description: string; source: string; template?: string }>> {
    const url = new URL('/command', this.baseUrl)
    const res = await fetch(url.toString())
    if (!res.ok) throw new Error(`opencode listCommands failed: ${res.status}`)
    const data = await res.json() as unknown
    return Array.isArray(data) ? (data as Array<{ name: string; description: string; source: string; template?: string }>) : []
  }

  async createSession(directory: string, title?: string): Promise<string> {
    const res = await this.sdk.session.create({
      query: { directory },
      body: title ? { title } : undefined
    })
    const data = res.data as { id?: string } | undefined
    if (!data?.id) throw new Error('opencode create returned no id')
    return data.id
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

  private closeEventStream(): void {
    const es = this.es
    if (!es) return
    // Detach all listeners BEFORE close() so that any events still in the
    // browser's internal queue cannot fire handlers against a now-defunct
    // ES instance after it has been nulled out. Without this, a late
    // onerror could race post-dispose and call scheduleReconnect against
    // a disposed client.
    es.onmessage = null
    es.onerror = null
    es.onopen = null
    const listeners = this.namedListeners
    for (const [type, listener] of listeners) {
      es.removeEventListener(type, listener)
    }
    this.namedListeners.clear()
    try {
      es.close()
    } catch {
      // eventsource lib may throw if already closed — safe to ignore
    }
    this.es = null
  }

  private openEventStream(): void {
    this.closeEventStream()
    const url = `${this.baseUrl}/event`
    const es = new EventSource(url)
    this.es = es

    // Default `message` event — opencode's standard frame.
    es.onmessage = (ev: MessageEvent): void => {
      if (this.disposed) return
      this.handleRawEvent(ev.data)
    }

    // Defensive: if the server emits `event: <type>\ndata: ...` (named SSE
    // events), onmessage will never fire. Register listeners for every
    // known type so the client is robust to either framing style. Keep
    // references so closeEventStream can detach them.
    for (const type of KNOWN_EVENT_TYPES) {
      const listener = (ev: MessageEvent): void => {
        if (this.disposed) return
        this.handleRawEvent(ev.data)
      }
      es.addEventListener(type, listener)
      this.namedListeners.set(type, listener)
    }

    es.onerror = (): void => {
      if (this.disposed) return
      this.closeEventStream()
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

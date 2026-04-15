/**
 * ClaudeFileWatchAdapter — wraps ClaudeMonitor for the adapter interface.
 *
 * Phase 8: write path added.
 *   - send(sessionId, text)  — resumes the session via ClaudeLauncher
 *   - abort(sessionId)       — SIGTERMs the running claude process
 *
 * canDispatch remains false (dispatch goes through instance:dispatch / ClaudeLauncher
 * directly, not through this adapter).
 *
 * Per-session FIFO queue prevents double-sends. Errors in one turn do not
 * poison subsequent turns (queue chain uses .catch(() => {})).
 *
 * External-process guard: if a pid for this sessionId exists in the monitor
 * but was NOT launched by flightdeck (i.e. not in the launcher's instances
 * map), send() throws a descriptive error so the user knows to reply from
 * their terminal instead.
 */
import { EventEmitter } from 'events'
import { readFile, stat, open } from 'fs/promises'
import { ClaudeMonitor } from './monitor'
import type { ClaudeLauncher } from './launcher'
import type { Adapter, AdapterSnapshot } from '../types'
import type { NormalizedProject } from '../opencode-http/types'
import type { ClaudeProject, ClaudeSession } from './types'
import { configStore } from '../../config/store'

// ── Reducer types ──────────────────────────────────────────────────────────

type AdapterEvent =
  | { source: 'stdout'; kind: 'tool_progress'; sessionId: string; toolName: string; turnId: number }
  | { source: 'stdout'; kind: 'control_request'; sessionId: string; requestId: string; toolName: string; input: Record<string, unknown>; toolUseId: string; turnId: number }
  | { source: 'stdout'; kind: 'result'; sessionId: string; subtype: string; turnId: number }
  | { source: 'file'; kind: 'session_update'; sessionId: string; session: ClaudeSession }

interface LiveEntry {
  session: ClaudeSession
  turnId: number
}

/**
 * Pure reducer — no side effects. Takes current LiveEntry and an event,
 * returns new LiveEntry (or undefined to remove from liveState).
 */
function reduceEntry(current: LiveEntry | undefined, event: AdapterEvent): LiveEntry | undefined {
  if (event.source === 'file' && event.kind === 'session_update') {
    // File-watch reconciliation: apply only when no active stdout stream owns state.
    if (current && current.session.pendingPermissionRequest) {
      // Approval pending — don't overwrite stdout-owned state.
      return current
    }
    // Merge file-watch session, preserving turnId.
    return {
      session: event.session,
      turnId: current?.turnId ?? 0
    }
  }

  // stdout events
  if (event.source === 'stdout') {
    // Drop stale events — event.turnId is older than what we've already applied.
    if (current && event.turnId < current.turnId) {
      return current
    }

    const base = current ?? {
      session: {
        sessionId: event.sessionId,
        pid: 0,
        cwd: '',
        startedAt: Date.now(),
        state: 'running' as const,
        currentAction: '',
        lastActivity: Date.now()
      },
      turnId: event.turnId
    }

    if (event.kind === 'tool_progress') {
      return {
        ...base,
        session: {
          ...base.session,
          currentAction: '⚙ ' + event.toolName
        }
      }
    }

    if (event.kind === 'control_request') {
      return {
        ...base,
        session: {
          ...base.session,
          state: 'approval',
          currentAction: '⚠ approve ' + event.toolName,
          pendingPermissionRequest: {
            requestId: event.requestId,
            toolName: event.toolName,
            input: event.input,
            toolUseId: event.toolUseId
          }
        }
      }
    }

    if (event.kind === 'result') {
      if (event.subtype === 'success' || event.subtype === 'permission_responded') {
        return {
          ...base,
          session: {
            ...base.session,
            state: 'idle',
            currentAction: '◌ idle',
            pendingPermissionRequest: null
          }
        }
      }
      // error_* subtypes
      if (event.subtype.startsWith('error')) {
        return {
          ...base,
          session: {
            ...base.session,
            state: 'error',
            currentAction: '✗ error',
            pendingPermissionRequest: null
          }
        }
      }
      // Unknown subtype — treat as success
      return {
        ...base,
        session: {
          ...base.session,
          state: 'idle',
          currentAction: '◌ idle',
          pendingPermissionRequest: null
        }
      }
    }
  }

  return current
}

const STDERR_CAP = 200

export class ClaudeFileWatchAdapter extends EventEmitter implements Adapter {
  readonly id = 'claude-file-watch'
  readonly label = 'ClaudeFileWatch'
  readonly canDispatch = false

  private monitor: ClaudeMonitor
  private launcher: ClaudeLauncher | null = null

  /** sessionIds that flightdeck has ever launched — never cleared (pid reuse safe). */
  private launchedSessions = new Set<string>()

  /** Per-session FIFO send queue — errors don't poison subsequent turns. */
  private sessionQueues = new Map<string, Promise<void>>()

  /** Per-session stderr log buffer, capped at STDERR_CAP lines. */
  private sessionLogs = new Map<string, string[]>()

  /** Live stdout-owned state for launcher-managed sessions. */
  private liveState = new Map<string, LiveEntry>()

  /** Per-session monotonic turn counter. Incremented on each result event. */
  private turnIds = new Map<string, number>()

  constructor(monitor: ClaudeMonitor) {
    super()
    this.monitor = monitor
    monitor.on('change', () => {
      // Push file-watch session_update events through reducer for sessions
      // that have no pending permission in liveState.
      const snap = monitor.getSnapshot()
      for (const project of snap.projects) {
        for (const session of project.sessions) {
          const live = this.liveState.get(session.sessionId)
          if (!live || !live.session.pendingPermissionRequest) {
            this.applyEvent({
              source: 'file',
              kind: 'session_update',
              sessionId: session.sessionId,
              session
            })
          }
        }
      }
      this.emit('change')
    })
  }

  private applyEvent(event: AdapterEvent): void {
    const current = this.liveState.get(event.sessionId)
    const next = reduceEntry(current, event)
    if (next !== undefined) {
      this.liveState.set(event.sessionId, next)
    }
  }

  private getTurnId(sessionId: string): number {
    return this.turnIds.get(sessionId) ?? 0
  }

  private bumpTurnId(sessionId: string): void {
    this.turnIds.set(sessionId, (this.turnIds.get(sessionId) ?? 0) + 1)
  }

  /** Wire the launcher after async creation (called from index.ts whenReady). */
  setLauncher(launcher: ClaudeLauncher): void {
    this.launcher = launcher
    // Track every pid the launcher starts so we can distinguish flightdeck
    // sessions from externally-launched ones.
    launcher.on('started', ({ sessionId }: { sessionId: string }) => {
      this.launchedSessions.add(sessionId)
    })
    // No removal — once flightdeck owns a session, it owns it for process lifetime.

    launcher.on('stopped', ({ sessionId }: { sessionId: string }) => {
      this.liveState.delete(sessionId)
      this.turnIds.delete(sessionId)
    })

    launcher.on('session:tool_progress', ({ sessionId, toolName }: { sessionId: string; toolName: string }) => {
      this.applyEvent({ source: 'stdout', kind: 'tool_progress', sessionId, toolName, turnId: this.getTurnId(sessionId) })
      this.emit('change')
    })

    launcher.on('session:control_request', ({ sessionId, requestId, toolName, input, toolUseId }: { sessionId: string; requestId: string; toolName: string; input: Record<string, unknown>; toolUseId: string }) => {
      this.applyEvent({ source: 'stdout', kind: 'control_request', sessionId, requestId, toolName, input, toolUseId, turnId: this.getTurnId(sessionId) })
      this.emit('change')
      this.emit('permission_request', { sessionId, requestId, toolName, input, toolUseId })
    })

    launcher.on('session:result', ({ sessionId, subtype }: { sessionId: string; subtype: string }) => {
      const prevTurnId = this.getTurnId(sessionId)
      this.applyEvent({ source: 'stdout', kind: 'result', sessionId, subtype, turnId: prevTurnId })
      this.bumpTurnId(sessionId)
      this.emit('change')
      // After turn ends, let file-watch reconcile after file settles.
      setTimeout(() => this.emit('change'), 500)
    })
  }

  start(): void {
    const cfg = configStore.get()
    if (cfg.mock.enabled) return
    this.monitor.start()
  }

  dispose(): void {
    this.monitor.dispose()
    this.sessionQueues.clear()
    this.sessionLogs.clear()
    this.launchedSessions.clear()
    this.removeAllListeners()
  }

  snapshot(): AdapterSnapshot {
    const snap = this.monitor.getSnapshot()
    const projects: NormalizedProject[] = snap.projects.map((cp: ClaudeProject) =>
      this.normalizeProject(cp)
    )
    return {
      projects,
      status: 'disabled',
      perInstance: []
    }
  }

  /** Expose underlying monitor for wiring (e.g. trackLaunchedSession). */
  getMonitor(): ClaudeMonitor {
    return this.monitor
  }

  // ── Write path ─────────────────────────────────────────────────────────────

  /**
   * Send a reply prompt to an existing Claude session.
   *
   * Queued per-session so concurrent callers never interleave. Errors in one
   * turn do not block subsequent turns.
   */
  async send(sessionId: string, text: string): Promise<void> {
    const prev = this.sessionQueues.get(sessionId) ?? Promise.resolve()
    const next = prev.then(() => this.doSend(sessionId, text))
    // Swallow the error on the queued chain so the next send can proceed.
    this.sessionQueues.set(sessionId, next.catch(() => {}))
    return next
  }

  /**
   * Respond to a pending permission request (allow or deny).
   */
  async respondPermission(sessionId: string, permissionId: string, response: 'once' | 'always' | 'reject'): Promise<void> {
    if (!this.launcher) throw new Error('ClaudeFileWatchAdapter: launcher not wired')
    const live = this.liveState.get(sessionId)
    const pending = live?.session.pendingPermissionRequest
    if (!pending || pending.requestId !== permissionId) {
      throw new Error(`no pending permission request ${permissionId} for session ${sessionId}`)
    }
    const allow = response === 'once' || response === 'always'
    this.launcher.respondToPermission(sessionId, permissionId, allow, pending.input)
    // Optimistically clear approval state
    this.applyEvent({ source: 'stdout', kind: 'result', sessionId, subtype: 'permission_responded', turnId: this.getTurnId(sessionId) })
    this.emit('change')
  }

  /**
   * Abort a running Claude session by sending SIGTERM via the launcher.
   */
  async abort(sessionId: string): Promise<void> {
    if (!this.launcher) throw new Error('ClaudeFileWatchAdapter: launcher not wired')
    await this.launcher.killSession(sessionId)
    this.sessionQueues.delete(sessionId)
    this.sessionLogs.delete(sessionId)
  }

  /**
   * Return buffered stderr lines for the session (up to STDERR_CAP).
   * Used by the `agent:logs` IPC handler.
   */
  getSessionLog(sessionId: string): string[] {
    return this.sessionLogs.get(sessionId) ?? []
  }

  async fetchMessages(sessionId: string): Promise<Array<{ info: unknown; parts: unknown[] }>> {
    const cwd = this.getCwd(sessionId)
    if (!cwd) return []

    const jsonlPath = await this.monitor.findJsonlPath(sessionId, cwd)
    if (!jsonlPath) return []

    const MAX_READ_BYTES = 5 * 1024 * 1024 // 5 MB cap

    let raw: string
    try {
      const fileStat = await stat(jsonlPath)
      const size = fileStat.size
      if (size <= MAX_READ_BYTES) {
        raw = await readFile(jsonlPath, 'utf8')
      } else {
        // Tail the last 5 MB to avoid stalling the event loop on large files.
        const fd = await open(jsonlPath, 'r')
        try {
          const buf = Buffer.alloc(MAX_READ_BYTES)
          await fd.read(buf, 0, MAX_READ_BYTES, size - MAX_READ_BYTES)
          raw = buf.toString('utf8')
          // Drop first (likely partial) line.
          const nl = raw.indexOf('\n')
          raw = nl >= 0 ? raw.slice(nl + 1) : raw
        } finally {
          await fd.close()
        }
      }
    } catch {
      return []
    }

    const results: Array<{ info: unknown; parts: unknown[] }> = []
    let lineIndex = 0
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      lineIndex++
      let entry: Record<string, unknown>
      try {
        entry = JSON.parse(trimmed) as Record<string, unknown>
      } catch {
        continue
      }
      const type = entry['type']
      if (type !== 'user' && type !== 'assistant') continue

      const msg = entry['message'] as Record<string, unknown> | undefined
      if (!msg) continue

      const role = (msg['role'] as string | undefined) ?? type
      const id = (msg['id'] as string | undefined)
        ?? (entry['uuid'] as string | undefined)
        ?? `claude-${sessionId}-${lineIndex}`

      // Parse timestamp for ordering.
      const ts = entry['timestamp']
      const created = typeof ts === 'string' ? Date.parse(ts) : undefined

      const rawContent = msg['content']
      let blocks: Array<Record<string, unknown>>
      if (typeof rawContent === 'string') {
        blocks = [{ type: 'text', text: rawContent }]
      } else if (Array.isArray(rawContent)) {
        blocks = rawContent as Array<Record<string, unknown>>
      } else {
        continue
      }

      const parts: unknown[] = []
      for (const block of blocks) {
        const btype = block['type'] as string | undefined
        if (btype === 'text') {
          const text = (block['text'] as string | undefined) ?? ''
          if (text) parts.push({ type: 'text', text })
        } else if (btype === 'tool_use') {
          const name = (block['name'] as string | undefined) ?? 'tool'
          const input = block['input']
          parts.push({
            type: 'tool',
            tool: name,
            state: {
              status: 'complete',
              input: input != null ? JSON.stringify(input, null, 2) : ''
            }
          })
        }
        // tool_result blocks skipped — pairing deferred to follow-up.
      }

      if (parts.length === 0) continue
      results.push({
        info: { role, id, ...(created !== undefined && !isNaN(created) ? { time: { created } } : {}) },
        parts
      })
    }

    return results
  }

  // ── Private send implementation ────────────────────────────────────────────

  private async doSend(sessionId: string, text: string): Promise<void> {
    if (!this.launcher) throw new Error('ClaudeFileWatchAdapter: launcher not wired')

    // If a subprocess is already running for this session, write to its stdin.
    if (this.launcher.hasActiveSession(sessionId)) {
      this.launcher.sendToStdin(sessionId, text)
      return
    }

    // External-process guard: if there is a pid for this session that we did
    // NOT launch, refuse and tell the user to reply from their terminal.
    const processes = this.monitor.getProcesses()
    for (const entry of processes.values()) {
      if (entry.sessionId === sessionId && !this.launchedSessions.has(sessionId)) {
        throw new Error(
          `Session ${sessionId} is owned by an external claude process (pid ${entry.pid}). Reply from that terminal instead.`
        )
      }
    }

    // Find cwd and profile for this session.
    const cwd = this.getCwd(sessionId)
    if (!cwd) throw new Error(`Session ${sessionId} not found in monitor`)

    const cfg = configStore.get()
    // Use the first claude-code profile as the profile context for resume
    // (model flag is omitted in buildResumeArgs, but profile.label is used
    // for log prefixes in the launcher).
    const profile = cfg.profiles.find((p) => p.agentType === 'claude-code') ?? {
      id: 'claude-code',
      label: 'claude-code',
      agentType: 'claude-code' as const,
      isDefault: false
    }

    // Buffer stderr for this session.
    const onStderr = (line: string): void => {
      const buf = this.sessionLogs.get(sessionId) ?? []
      buf.push(line)
      if (buf.length > STDERR_CAP) buf.shift()
      this.sessionLogs.set(sessionId, buf)
    }

    const result = await this.launcher.resume(sessionId, profile, cwd, text, { onStderr })

    // Register the new pid with the monitor so it starts watching the JSONL.
    this.monitor.trackLaunchedSession({
      pid: result.pid,
      sessionId: result.sessionId,
      cwd,
      startedAt: Date.now()
    })

    // Wait for this turn's subprocess to exit before the queue resolves.
    // This ensures the next queued send doesn't start while claude is still running.
    await result.done
  }

  private getCwd(sessionId: string): string | undefined {
    for (const entry of this.monitor.getProcesses().values()) {
      if (entry.sessionId === sessionId) return entry.cwd
    }
    // Fallback: scan snapshot (session may be idle with no live process).
    const snap = this.monitor.getSnapshot()
    for (const project of snap.projects) {
      for (const session of project.sessions) {
        if (session.sessionId === sessionId) return session.cwd
      }
    }
    return undefined
  }

  // ── Normalization ──────────────────────────────────────────────────────────

  private normalizeProject(claudeProject: ClaudeProject): NormalizedProject {
    return {
      id: claudeProject.path,
      name: claudeProject.name,
      path: claudeProject.path,
      sessions: claudeProject.sessions.map((s) => {
        const live = this.liveState.get(s.sessionId)
        const session = live?.session ?? s
        return {
          id: session.sessionId,
          agentType: 'claude-code' as const,
          state: session.state as 'running' | 'idle' | 'error' | 'question' | 'approval',
          currentAction: session.currentAction,
          startedAt: s.startedAt,
          lastActivity: s.lastActivity,
          projectId: claudeProject.path,
          instanceKey: `claude:${s.pid}`,
          pendingPermission: session.pendingPermissionRequest
            ? {
                id: session.pendingPermissionRequest.requestId,
                type: session.pendingPermissionRequest.toolName,
                title: `Allow ${session.pendingPermissionRequest.toolName}`,
                metadata: session.pendingPermissionRequest.input
              }
            : null,
          ...(s.statusLine !== undefined ? { statusLine: s.statusLine } : {})
        }
      })
    }
  }
}

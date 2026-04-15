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
import type { ClaudeProject } from './types'
import { configStore } from '../../config/store'

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

  constructor(monitor: ClaudeMonitor) {
    super()
    this.monitor = monitor
    monitor.on('change', () => this.emit('change'))
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
      sessions: claudeProject.sessions.map((s) => ({
        id: s.sessionId,
        agentType: 'claude-code' as const,
        state: s.state as 'running' | 'idle' | 'error' | 'question',
        currentAction: s.currentAction,
        startedAt: s.startedAt,
        lastActivity: s.lastActivity,
        projectId: claudeProject.path,
        instanceKey: `claude:${s.pid}`,
        pendingPermission: null,
        ...(s.statusLine !== undefined ? { statusLine: s.statusLine } : {})
      }))
    }
  }
}

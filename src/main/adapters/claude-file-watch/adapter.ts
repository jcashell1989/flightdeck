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
 * but was NOT launched by flight deck (i.e. not in the launcher's instances
 * map), send() throws a descriptive error so the user knows to reply from
 * their terminal instead.
 */
import { EventEmitter } from 'events'
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

  /** pids that flight deck launched (via trackLaunchedSession) */
  private launchedPids = new Set<number>()

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
    // Track every pid the launcher starts so we can distinguish flight-deck
    // sessions from externally-launched ones.
    launcher.on('started', ({ pid }: { pid: number }) => {
      this.launchedPids.add(pid)
    })
    launcher.on('stopped', ({ pid }: { pid: number }) => {
      this.launchedPids.delete(pid)
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
    this.launchedPids.clear()
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
    // Clear the queue entry so stale sends don't fire after abort.
    this.sessionQueues.delete(sessionId)
  }

  /**
   * Return buffered stderr lines for the session (up to STDERR_CAP).
   * Used by the `agent:logs` IPC handler.
   */
  getSessionLog(sessionId: string): string[] {
    return this.sessionLogs.get(sessionId) ?? []
  }

  // ── Private send implementation ────────────────────────────────────────────

  private async doSend(sessionId: string, text: string): Promise<void> {
    if (!this.launcher) throw new Error('ClaudeFileWatchAdapter: launcher not wired')

    // External-process guard: if there is a pid for this session that we did
    // NOT launch, refuse and tell the user to reply from their terminal.
    const processes = this.monitor.getProcesses()
    for (const entry of processes.values()) {
      if (entry.sessionId === sessionId && !this.launchedPids.has(entry.pid)) {
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

/**
 * ClaudeMonitor — passively monitors Claude Code sessions.
 *
 * Data sources:
 *   1. ~/.claude/sessions/<pid>.json — live process registry
 *   2. ~/.claude/projects/<encoded-path>/<session-uuid>.jsonl — conversation logs
 *
 * Strategy:
 *   - Watch ~/.claude/sessions/ for new/removed process JSON files (chokidar)
 *   - Watch ~/.claude/projects/ for JSONL file changes (chokidar, depth 1)
 *   - Poll process liveness every LIVENESS_POLL_MS via kill -0
 *   - Emit 'change' whenever the snapshot mutates
 *
 * The monitor is read-only. It never writes to any Claude Code files.
 */
import { EventEmitter } from 'events'
import { promises as fs } from 'fs'
import { join, basename } from 'path'
import { homedir } from 'os'
import { watch, FSWatcher } from 'chokidar'
import { parseSessionState, projectName, encodeProjectPath } from './parser'
import type { ClaudeSession, ClaudeProject, ClaudeSnapshot } from './types'

const SESSIONS_DIR = join(homedir(), '.claude', 'sessions')
const PROJECTS_DIR = join(homedir(), '.claude', 'projects')
const LIVENESS_POLL_MS = 5000

/** Check if a process is alive using kill -0 (no signal sent, just checks). */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

interface ProcessEntry {
  pid: number
  sessionId: string
  cwd: string
  startedAt: number
}

export class ClaudeMonitor extends EventEmitter {
  private sessionsWatcher: FSWatcher | null = null
  private projectsWatcher: FSWatcher | null = null
  private livenessTimer: NodeJS.Timeout | null = null
  private disposed = false

  /** pid → ProcessEntry (from ~/.claude/sessions/<pid>.json) */
  private processes = new Map<number, ProcessEntry>()

  /** sessionId → ClaudeSession (current inferred state) */
  private sessions = new Map<string, ClaudeSession>()

  start(): void {
    // Ensure watch roots exist — on a fresh macOS install ~/.claude/sessions
    // and ~/.claude/projects may not have been created yet, and chokidar
    // silently fails to fire events on non-existent paths.
    void fs.mkdir(SESSIONS_DIR, { recursive: true }).catch(() => undefined)
    void fs.mkdir(PROJECTS_DIR, { recursive: true }).catch(() => undefined)
    this.watchSessions()
    this.watchProjects()
    this.startLivenessPoll()
  }

  dispose(): void {
    this.disposed = true
    // chokidar close() returns a promise; attach a catch so a rejection can't
    // become an unhandled rejection later. We do NOT await here because
    // dispose() is called synchronously from before-quit; the disposed flag
    // guards any handler that fires during the close window.
    this.sessionsWatcher?.close().catch((err) => {
      console.error('[ClaudeMonitor] sessions watcher close error:', err)
    })
    this.projectsWatcher?.close().catch((err) => {
      console.error('[ClaudeMonitor] projects watcher close error:', err)
    })
    this.sessionsWatcher = null
    this.projectsWatcher = null
    if (this.livenessTimer) clearInterval(this.livenessTimer)
    this.livenessTimer = null
    this.processes.clear()
    this.sessions.clear()
    this.removeAllListeners()
  }

  getSnapshot(): ClaudeSnapshot {
    // Group sessions by project path.
    const byPath = new Map<string, ClaudeSession[]>()
    for (const session of this.sessions.values()) {
      const existing = byPath.get(session.cwd) ?? []
      existing.push(session)
      byPath.set(session.cwd, existing)
    }

    const projects: ClaudeProject[] = []
    for (const [path, sessions] of byPath) {
      projects.push({
        encodedPath: encodeProjectPath(path),
        path,
        name: projectName(path),
        sessions
      })
    }

    return { projects }
  }

  // ── Session file watching ──────────────────────────────────────────────────

  private watchSessions(): void {
    this.sessionsWatcher = watch(SESSIONS_DIR, {
      depth: 0,
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }
    })

    this.sessionsWatcher.on('add', (filePath) => {
      if (filePath.endsWith('.json')) void this.loadProcessEntry(filePath)
    })

    this.sessionsWatcher.on('unlink', (filePath) => {
      if (filePath.endsWith('.json')) {
        const pid = parseInt(basename(filePath, '.json'), 10)
        if (!isNaN(pid)) this.removeProcess(pid)
      }
    })

    this.sessionsWatcher.on('error', (err) => {
      console.error('[ClaudeMonitor] sessions watcher error:', err)
    })
  }

  private async loadProcessEntry(filePath: string): Promise<void> {
    if (this.disposed) return
    try {
      const raw = await fs.readFile(filePath, 'utf8')
      const data = JSON.parse(raw) as {
        pid?: number
        sessionId?: string
        cwd?: string
        startedAt?: number
      }
      if (
        typeof data.pid !== 'number' ||
        typeof data.sessionId !== 'string' ||
        typeof data.cwd !== 'string' ||
        typeof data.startedAt !== 'number'
      ) {
        return
      }
      if (this.disposed) return
      const entry: ProcessEntry = {
        pid: data.pid,
        sessionId: data.sessionId,
        cwd: data.cwd,
        startedAt: data.startedAt
      }
      this.processes.set(entry.pid, entry)
      await this.refreshSession(entry)
    } catch {
      // File may have been removed before we read it — ignore.
    }
  }

  private removeProcess(pid: number): void {
    const entry = this.processes.get(pid)
    if (!entry) return
    this.processes.delete(pid)

    // Mark session as idle (clean exit) or keep as error (was running).
    const session = this.sessions.get(entry.sessionId)
    if (session) {
      if (session.state === 'running') {
        // Process died while running — treat as error.
        this.sessions.set(entry.sessionId, { ...session, state: 'error' })
      } else {
        // Clean exit — remove immediately (process is already gone from this.processes,
        // so pollLiveness will never see it to clean up).
        this.sessions.delete(entry.sessionId)
      }
    }
    this.emit('change')
  }

  // ── Project JSONL watching ─────────────────────────────────────────────────

  private watchProjects(): void {
    this.projectsWatcher = watch(PROJECTS_DIR, {
      depth: 1,
      ignoreInitial: true, // sessions watcher handles initial hydration
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }
    })

    this.projectsWatcher.on('change', (filePath) => {
      if (filePath.endsWith('.jsonl')) void this.refreshSessionByJsonl(filePath)
    })

    this.projectsWatcher.on('add', (filePath) => {
      if (filePath.endsWith('.jsonl')) void this.refreshSessionByJsonl(filePath)
    })

    this.projectsWatcher.on('error', (err) => {
      console.error('[ClaudeMonitor] projects watcher error:', err)
    })
  }

  private async refreshSessionByJsonl(jsonlPath: string): Promise<void> {
    // Extract sessionId from filename: <session-uuid>.jsonl
    const sessionId = basename(jsonlPath, '.jsonl')
    // Find the process entry for this session.
    let entry: ProcessEntry | undefined
    for (const e of this.processes.values()) {
      if (e.sessionId === sessionId) {
        entry = e
        break
      }
    }
    if (!entry) return // Not a session we're tracking.
    await this.refreshSession(entry)
  }

  // ── State refresh ──────────────────────────────────────────────────────────

  private async refreshSession(entry: ProcessEntry): Promise<void> {
    if (this.disposed) return

    // Find the JSONL file for this session.
    const jsonlPath = await this.findJsonlPath(entry.sessionId, entry.cwd)

    let state: ClaudeSession['state'] = 'idle'
    let currentAction = '◌ idle'
    let lastActivity = entry.startedAt

    if (jsonlPath) {
      const parsed = await parseSessionState(jsonlPath, entry.startedAt)
      if (parsed) {
        state = parsed.state
        currentAction = parsed.currentAction
        lastActivity = parsed.lastActivity
      }
    } else {
      // No JSONL yet — session just started.
      state = 'running'
      currentAction = '⚙ starting…'
    }

    // If process is dead, override state.
    if (!isProcessAlive(entry.pid)) {
      if (state === 'running') state = 'error'
      // idle stays idle
    }

    const prev = this.sessions.get(entry.sessionId)
    const next: ClaudeSession = {
      sessionId: entry.sessionId,
      pid: entry.pid,
      cwd: entry.cwd,
      startedAt: entry.startedAt,
      state,
      currentAction,
      lastActivity
    }

    // Only emit if something changed.
    if (
      !prev ||
      prev.state !== next.state ||
      prev.currentAction !== next.currentAction ||
      prev.lastActivity !== next.lastActivity
    ) {
      this.sessions.set(entry.sessionId, next)
      this.emit('change')
    }
  }

  private async findJsonlPath(sessionId: string, cwd: string): Promise<string | null> {
    // Primary: look in the project directory for this cwd.
    const encoded = encodeProjectPath(cwd)
    const projectDir = join(PROJECTS_DIR, encoded)
    const candidate = join(projectDir, `${sessionId}.jsonl`)
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      // Not found in expected location — scan all project dirs.
    }

    // Fallback: scan all project directories.
    try {
      const projectDirs = await fs.readdir(PROJECTS_DIR)
      for (const dir of projectDirs) {
        const p = join(PROJECTS_DIR, dir, `${sessionId}.jsonl`)
        try {
          await fs.access(p)
          return p
        } catch {
          // continue
        }
      }
    } catch {
      // PROJECTS_DIR doesn't exist yet.
    }

    return null
  }

  // ── Liveness polling ───────────────────────────────────────────────────────

  private startLivenessPoll(): void {
    this.livenessTimer = setInterval(() => {
      if (this.disposed) return
      void this.pollLiveness()
    }, LIVENESS_POLL_MS)
  }

  private async pollLiveness(): Promise<void> {
    let changed = false

    for (const [pid, entry] of this.processes) {
      if (!isProcessAlive(pid)) {
        // Process is dead — remove from tracking.
        this.processes.delete(pid)
        const session = this.sessions.get(entry.sessionId)
        if (session && session.state === 'running') {
          this.sessions.set(entry.sessionId, { ...session, state: 'error' })
          changed = true
        }
        // Remove dead idle sessions from the map (clean up stale entries).
        if (session && session.state === 'idle') {
          this.sessions.delete(entry.sessionId)
          changed = true
        }
      }
    }

    if (changed) this.emit('change')
  }
}

export const claudeMonitor = new ClaudeMonitor()

/**
 * OpencodeFileWatchAdapter — passively monitors externally-started opencode
 * TUI sessions by watching ~/.local/share/opencode/storage/.
 *
 * Data sources:
 *   storage/session/<projectID>/<sessionID>.json  — session metadata
 *   storage/project/<projectID>.json              — project metadata (worktree path)
 *
 * Strategy:
 *   - Watch storage/session/ with chokidar (depth=1) for add/change/unlink events
 *   - On any change: re-read the affected session file, rebuild the snapshot
 *   - Resolve project name from storage/project/<projectID>.json
 *   - Poll every POLL_MS (5s) to catch sessions that stop changing but need
 *     state inference (e.g. idle detection)
 *   - Emit 'change' whenever the snapshot mutates
 *
 * The adapter is read-only: controlMode = 'watched', canDispatch = false.
 * No write methods are implemented (canReply/canCommand/canAbort = false).
 *
 * Mock mode: if config.mock.enabled, start() returns immediately — no
 * watchers, no sessions.
 */
import { EventEmitter } from 'events'
import { promises as fs } from 'fs'
import { join, basename } from 'path'
import { homedir } from 'os'
import { watch, FSWatcher } from 'chokidar'
import { configStore } from '../../config/store'
import type { NormalizedProject } from '../../opencode/types'

// ── Storage path resolution ────────────────────────────────────────────────

function storageRoot(): string {
  const xdg = process.env['XDG_DATA_HOME']
  const base = xdg ?? join(homedir(), '.local', 'share')
  return join(base, 'opencode', 'storage')
}

const POLL_MS = 5000
/** Sessions updated more than this many ms ago are considered historical and excluded. */
const RECENCY_WINDOW_MS = 30 * 60 * 1000 // 30 minutes

// ── JSON shapes ─────────────────────────────────────────────────────────────

interface StorageSession {
  id: string
  projectID?: string
  directory?: string
  title?: string
  time?: { created?: number; updated?: number }
}

interface StorageProject {
  id?: string
  worktree?: string
}

// ── Internal state ───────────────────────────────────────────────────────────

interface TrackedSession {
  id: string
  projectID: string
  directory: string
  title: string
  createdAt: number
  updatedAt: number
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function projectName(worktree: string): string {
  const parts = worktree.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? worktree
}

export class OpencodeFileWatchMonitor extends EventEmitter {
  readonly id = 'opencode-file-watch'
  readonly label = 'OpencodeFileWatch'
  readonly canDispatch = false

  private sessionWatcher: FSWatcher | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private disposed = false

  /** sessionID → TrackedSession */
  private sessions = new Map<string, TrackedSession>()
  /** projectID → worktree path */
  private projectPaths = new Map<string, string>()

  start(): void {
    const cfg = configStore.get()
    if (cfg.mock.enabled) {
      // Mock mode: no file watching, no sessions.
      return
    }

    const sessionDir = join(storageRoot(), 'session')

    // Ensure the directory exists so chokidar doesn't silently fail.
    void fs.mkdir(sessionDir, { recursive: true }).catch(() => undefined)

    this.sessionWatcher = watch(sessionDir, {
      depth: 1,
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }
    })

    this.sessionWatcher.on('add', (filePath) => {
      if (filePath.endsWith('.json')) void this.loadSession(filePath)
    })

    this.sessionWatcher.on('change', (filePath) => {
      if (filePath.endsWith('.json')) void this.loadSession(filePath)
    })

    this.sessionWatcher.on('unlink', (filePath) => {
      if (filePath.endsWith('.json')) {
        const sessionId = basename(filePath, '.json')
        if (this.sessions.has(sessionId)) {
          this.sessions.delete(sessionId)
          this.emit('change')
        }
      }
    })

    this.sessionWatcher.on('error', (err) => {
      console.error('[OpencodeFileWatch] watcher error:', err)
    })

    // Periodic poll to catch state transitions (e.g. idle detection).
    this.pollTimer = setInterval(() => {
      if (this.disposed) return
      void this.poll()
    }, POLL_MS)
  }

  dispose(): void {
    this.disposed = true
    this.sessionWatcher?.close().catch((err) => {
      console.error('[OpencodeFileWatch] watcher close error:', err)
    })
    this.sessionWatcher = null
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
    this.sessions.clear()
    this.projectPaths.clear()
    this.removeAllListeners()
  }

  getSnapshot(): NormalizedProject[] {
    const now = Date.now()
    const byProject = new Map<string, TrackedSession[]>()

    for (const session of this.sessions.values()) {
      // Exclude sessions outside the recency window (historical).
      if (now - session.updatedAt > RECENCY_WINDOW_MS) continue

      const existing = byProject.get(session.projectID) ?? []
      existing.push(session)
      byProject.set(session.projectID, existing)
    }

    const projects: NormalizedProject[] = []
    for (const [projectID, sessions] of byProject) {
      const worktree = this.projectPaths.get(projectID)
      // Use worktree as the path; fall back to first session's directory if
      // the project file hasn't been loaded yet.
      const path = worktree ?? sessions[0]?.directory ?? projectID
      const name = projectName(path)

      projects.push({
        id: `opencode-file-watch:${projectID}`,
        name,
        path,
        sessions: sessions.map((s) => ({
          id: s.id,
          agentType: 'opencode' as const,
          state: 'idle' as const,
          currentAction: '◌ idle',
          startedAt: s.createdAt,
          lastActivity: s.updatedAt,
          projectId: `opencode-file-watch:${projectID}`,
          instanceKey: `opencode-file-watch:${s.id}`,
          pendingPermission: null
        }))
      })
    }

    return projects
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private async loadSession(filePath: string): Promise<void> {
    if (this.disposed) return
    try {
      const raw = await fs.readFile(filePath, 'utf8')
      const data = JSON.parse(raw) as StorageSession

      if (
        typeof data.id !== 'string' ||
        !data.id.startsWith('ses_')
      ) {
        return
      }

      const session: TrackedSession = {
        id: data.id,
        projectID: typeof data.projectID === 'string' ? data.projectID : 'global',
        directory: typeof data.directory === 'string' ? data.directory : '',
        title: typeof data.title === 'string' ? data.title : data.id,
        createdAt: data.time?.created ?? Date.now(),
        updatedAt: data.time?.updated ?? Date.now()
      }

      // Resolve project path if not cached.
      if (!this.projectPaths.has(session.projectID)) {
        await this.loadProjectPath(session.projectID)
      }

      const prev = this.sessions.get(session.id)
      this.sessions.set(session.id, session)

      if (
        !prev ||
        prev.updatedAt !== session.updatedAt ||
        prev.title !== session.title
      ) {
        this.emit('change')
      }
    } catch {
      // File removed or unreadable — ignore.
    }
  }

  private async loadProjectPath(projectID: string): Promise<void> {
    if (this.disposed) return
    const projectFile = join(storageRoot(), 'project', `${projectID}.json`)
    try {
      const raw = await fs.readFile(projectFile, 'utf8')
      const data = JSON.parse(raw) as StorageProject
      if (typeof data.worktree === 'string' && data.worktree.length > 0) {
        this.projectPaths.set(projectID, data.worktree)
      }
    } catch {
      // Project file may not exist (e.g. 'global' project without a file).
      // Fall back to session.directory in getSnapshot().
    }
  }

  private async poll(): Promise<void> {
    if (this.disposed) return
    // Re-scan session directory to catch any files that slipped past chokidar.
    const sessionDir = join(storageRoot(), 'session')
    try {
      const projectDirs = await fs.readdir(sessionDir)
      for (const projectDirName of projectDirs) {
        const subDir = join(sessionDir, projectDirName)
        let stat: Awaited<ReturnType<typeof fs.stat>>
        try {
          stat = await fs.stat(subDir)
        } catch {
          continue
        }
        if (!stat.isDirectory()) continue

        const files = await fs.readdir(subDir)
        for (const file of files) {
          if (file.endsWith('.json')) {
            const sessionId = basename(file, '.json')
            if (!this.sessions.has(sessionId)) {
              await this.loadSession(join(subDir, file))
            }
          }
        }
      }
    } catch {
      // Directory doesn't exist yet — ignore.
    }
  }
}

export const opencodeFileWatchMonitor = new OpencodeFileWatchMonitor()

/**
 * OpencodeFileWatchAdapter — passively monitors externally-started opencode
 * TUI sessions by reading from ~/.local/share/opencode/opencode.db.
 *
 * opencode migrated from JSON file storage (storage/session/<id>.json) to a
 * SQLite database in a later release. This adapter was updated accordingly:
 * instead of watching JSON files with chokidar, it polls the SQLite database
 * every POLL_MS using the built-in `node:sqlite` module (Node 22.5+, no extra
 * dependency).
 *
 * Strategy:
 *   - Poll every POLL_MS (5s): SELECT sessions WHERE time_updated > now - RECENCY_WINDOW_MS
 *   - JOIN project table to resolve the worktree path
 *   - Emit 'change' when the session set mutates
 *
 * The adapter is read-only: controlMode = 'watched', canDispatch = false.
 *
 * Mock mode: if config.mock.enabled, start() returns immediately — no polling.
 */
import { EventEmitter } from 'events'
import { join } from 'path'
import { homedir } from 'os'
import { DatabaseSync } from 'node:sqlite'
import { configStore } from '../../config/store'
import type { NormalizedProject } from '../opencode-http/types'

// ── Storage path resolution ────────────────────────────────────────────────

function dbPath(): string {
  const xdg = process.env['XDG_DATA_HOME']
  const base = xdg ?? join(homedir(), '.local', 'share')
  return join(base, 'opencode', 'opencode.db')
}

const POLL_MS = 5000
/** Sessions updated more than this many ms ago are considered historical and excluded. */
const RECENCY_WINDOW_MS = 30 * 60 * 1000 // 30 minutes

// ── SQLite row shapes ────────────────────────────────────────────────────────

interface SessionRow {
  id: string
  project_id: string
  directory: string
  title: string
  time_created: number
  time_updated: number
  worktree: string | null
}

// ── Internal state ───────────────────────────────────────────────────────────

interface TrackedSession {
  id: string
  projectID: string
  directory: string
  title: string
  createdAt: number
  updatedAt: number
  worktree: string | null
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

  private pollTimer: NodeJS.Timeout | null = null
  private disposed = false

  /** sessionID → TrackedSession */
  private sessions = new Map<string, TrackedSession>()

  start(): void {
    const cfg = configStore.get()
    if (cfg.mock.enabled) {
      return
    }

    // Run an immediate poll so the snapshot is populated before the first timer fires.
    void this.poll()

    this.pollTimer = setInterval(() => {
      if (this.disposed) return
      void this.poll()
    }, POLL_MS)
  }

  dispose(): void {
    this.disposed = true
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
    this.sessions.clear()
    this.removeAllListeners()
  }

  getSnapshot(): NormalizedProject[] {
    const byProject = new Map<string, TrackedSession[]>()

    for (const session of this.sessions.values()) {
      const existing = byProject.get(session.projectID) ?? []
      existing.push(session)
      byProject.set(session.projectID, existing)
    }

    const projects: NormalizedProject[] = []
    for (const [projectID, sessions] of byProject) {
      const worktree = sessions[0]?.worktree ?? sessions[0]?.directory ?? projectID
      const name = projectName(worktree)

      projects.push({
        id: `opencode-file-watch:${projectID}`,
        name,
        path: worktree,
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

  private async poll(): Promise<void> {
    if (this.disposed) return

    let rows: SessionRow[] = []
    try {
      const db = new DatabaseSync(dbPath(), { readOnly: true })
      try {
        const stmt = db.prepare(`
          SELECT
            s.id,
            s.project_id,
            s.directory,
            s.title,
            s.time_created,
            s.time_updated,
            p.worktree
          FROM session s
          LEFT JOIN project p ON s.project_id = p.id
          WHERE s.time_updated > ?
          ORDER BY s.time_updated DESC
        `)
        rows = stmt.all(Date.now() - RECENCY_WINDOW_MS) as unknown as SessionRow[]
      } finally {
        db.close()
      }
    } catch {
      // DB missing or locked — keep existing snapshot, retry next poll.
      return
    }

    // Rebuild session map from query results.
    const next = new Map<string, TrackedSession>()
    for (const row of rows) {
      next.set(row.id, {
        id: row.id,
        projectID: row.project_id,
        directory: row.directory,
        title: row.title,
        createdAt: row.time_created,
        updatedAt: row.time_updated,
        worktree: row.worktree ?? null
      })
    }

    // Emit change only if the session set actually changed.
    if (!this.setsEqual(this.sessions, next)) {
      this.sessions = next
      this.emit('change')
    }
  }

  private setsEqual(
    a: Map<string, TrackedSession>,
    b: Map<string, TrackedSession>
  ): boolean {
    if (a.size !== b.size) return false
    for (const [id, sa] of a) {
      const sb = b.get(id)
      if (!sb || sa.updatedAt !== sb.updatedAt) return false
    }
    return true
  }
}

export const opencodeFileWatchMonitor = new OpencodeFileWatchMonitor()

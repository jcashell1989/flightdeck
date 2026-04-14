import { DatabaseSync } from 'node:sqlite'

export interface SessionRecord {
  id: string
  agentType: string
  projectId: string
  projectPath: string
  state: string
  startedAt: number
  lastActivity: number
}

export class FlightDeckDb {
  private db: InstanceType<typeof DatabaseSync> | null = null

  open(dbPath: string): void {
    this.db = new DatabaseSync(dbPath)
    this.migrate()
  }

  close(): void {
    try { this.db?.close() } catch { /* ignore */ }
    this.db = null
  }

  private migrate(): void {
    const db = this.db!
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
    `)
    const existing = db.prepare('SELECT COUNT(*) as n FROM schema_version').get() as { n: number }
    if (existing.n === 0) db.exec(`INSERT INTO schema_version VALUES (0)`)
    const row = db.prepare('SELECT version FROM schema_version').get() as { version: number }
    let version = row.version

    if (version < 1) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS session_history (
          id TEXT PRIMARY KEY,
          agent_type TEXT NOT NULL,
          project_id TEXT NOT NULL,
          project_path TEXT NOT NULL,
          state TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          last_activity INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sh_last_activity ON session_history (last_activity DESC);
        UPDATE schema_version SET version = 1;
      `)
      version = 1
    }
  }

  upsertSession(s: SessionRecord): void {
    if (!this.db) return
    try {
      this.db.prepare(`
        INSERT INTO session_history (id, agent_type, project_id, project_path, state, started_at, last_activity)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          state = excluded.state,
          last_activity = excluded.last_activity
      `).run(s.id, s.agentType, s.projectId, s.projectPath, s.state, s.startedAt, s.lastActivity)
    } catch (err) {
      console.warn('[FlightDeckDb] upsertSession error:', err)
    }
  }

  getRecentSessions(limit = 50, windowMs = 7 * 24 * 60 * 60 * 1000): SessionRecord[] {
    if (!this.db) return []
    try {
      const cutoff = Date.now() - windowMs
      const rows = this.db.prepare(`
        SELECT id, agent_type, project_id, project_path, state, started_at, last_activity
        FROM session_history
        WHERE last_activity > ?
        ORDER BY last_activity DESC
        LIMIT ?
      `).all(cutoff, limit) as Array<{
        id: string; agent_type: string; project_id: string; project_path: string
        state: string; started_at: number; last_activity: number
      }>
      return rows.map(r => ({
        id: r.id, agentType: r.agent_type, projectId: r.project_id,
        projectPath: r.project_path, state: r.state,
        startedAt: r.started_at, lastActivity: r.last_activity
      }))
    } catch (err) {
      console.warn('[FlightDeckDb] getRecentSessions error:', err)
      return []
    }
  }
}

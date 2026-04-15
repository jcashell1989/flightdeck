/**
 * db.ts — isolated SQLite wrapper for ~/.codex/state_5.sqlite
 *
 * All node:sqlite access is gated behind a dynamic import so the module
 * degrades gracefully if the experimental API is unavailable. This file is
 * the only place in the codebase that touches node:sqlite — swapping to
 * better-sqlite3 is a one-file change.
 */
import { join } from 'path'
import { homedir } from 'os'
import { existsSync } from 'fs'
import type { CodexSession } from './types'

const DB_PATH = join(homedir(), '.codex', 'state_5.sqlite')
const RUNNING_WINDOW_MS = 60_000
const MAX_SESSIONS = 200
const SLOW_QUERY_WARN_MS = 10

// Lazily resolved — null means unavailable or not yet attempted.
let DatabaseSync: (typeof import('node:sqlite'))['DatabaseSync'] | null = null
let dbInitAttempted = false

async function ensureDb(): Promise<boolean> {
  if (dbInitAttempted) return DatabaseSync !== null
  dbInitAttempted = true
  try {
    const mod = await import('node:sqlite')
    DatabaseSync = mod.DatabaseSync
  } catch {
    console.warn('[CodexDb] node:sqlite unavailable — Codex monitoring disabled')
  }
  return DatabaseSync !== null
}

export async function readCodexSessions(): Promise<CodexSession[]> {
  if (!existsSync(DB_PATH)) return []
  if (!(await ensureDb())) return []

  const t0 = performance.now()
  try {
    // DatabaseSync is synchronous but fast for small result sets.
    const db = new DatabaseSync!(DB_PATH, { readOnly: true })
    const rows = db
      .prepare(
        `SELECT id, title, cwd, model, created_at, updated_at
         FROM threads
         WHERE archived = 0
         ORDER BY updated_at DESC
         LIMIT ${MAX_SESSIONS}`
      )
      .all() as Array<{
      id: string
      title: string
      cwd: string
      model: string
      created_at: number
      updated_at: number
    }>
    db.close()

    const elapsed = performance.now() - t0
    if (elapsed > SLOW_QUERY_WARN_MS) {
      console.warn(`[CodexDb] slow query: ${elapsed.toFixed(1)}ms — consider migrating to better-sqlite3`)
    }

    const now = Date.now()
    return rows.map((r) => ({
      id: r.id,
      title: r.title || r.id,
      cwd: r.cwd,
      model: r.model || 'unknown',
      state: now - r.updated_at * 1000 < RUNNING_WINDOW_MS ? 'running' : 'idle',
      startedAt: r.created_at * 1000,
      lastActivity: r.updated_at * 1000
    }))
  } catch (err) {
    console.warn('[CodexDb] read error:', err)
    return []
  }
}

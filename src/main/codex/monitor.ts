/**
 * CodexMonitor — passively monitors Codex CLI sessions via ~/.codex/state_5.sqlite
 *
 * Strategy:
 *   - chokidar watches state_5.sqlite + state_5.sqlite-wal (WAL journal)
 *   - 5s poll fallback covers cases where chokidar misses a write
 *   - Emits 'change' whenever the snapshot mutates
 *
 * The monitor is read-only. It never writes to any Codex files.
 */
import { EventEmitter } from 'events'
import { join } from 'path'
import { homedir } from 'os'
import { promises as fs } from 'fs'
import { watch, FSWatcher } from 'chokidar'
import { readCodexSessions } from './db'
import type { CodexSession, CodexSnapshot } from './types'

const CODEX_DIR = join(homedir(), '.codex')
const DB_PATH = join(CODEX_DIR, 'state_5.sqlite')
const DB_WAL_PATH = join(CODEX_DIR, 'state_5.sqlite-wal')
const POLL_INTERVAL_MS = 5_000

export class CodexMonitor extends EventEmitter {
  private watcher: FSWatcher | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private sessions: CodexSession[] = []
  private disposed = false

  start(): void {
    // Ensure ~/.codex exists before watching — chokidar silently fails on missing dirs.
    void fs.mkdir(CODEX_DIR, { recursive: true }).catch(() => undefined)

    this.watcher = watch([DB_PATH, DB_WAL_PATH], {
      ignoreInitial: false,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 }
    })

    this.watcher.on('add', () => void this.refresh())
    this.watcher.on('change', () => void this.refresh())
    this.watcher.on('error', (err) => {
      console.warn('[CodexMonitor] watcher error:', err)
    })

    this.pollTimer = setInterval(() => {
      if (!this.disposed) void this.refresh()
    }, POLL_INTERVAL_MS)

    // Initial read
    void this.refresh()
  }

  dispose(): void {
    this.disposed = true
    this.watcher?.close().catch((err) => {
      console.error('[CodexMonitor] watcher close error:', err)
    })
    this.watcher = null
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
    this.sessions = []
    this.removeAllListeners()
  }

  getSnapshot(): CodexSnapshot {
    return { sessions: [...this.sessions] }
  }

  private async refresh(): Promise<void> {
    if (this.disposed) return
    try {
      const next = await readCodexSessions()
      if (this.disposed) return
      if (!this.snapshotEqual(this.sessions, next)) {
        this.sessions = next
        this.emit('change')
      }
    } catch (err) {
      console.warn('[CodexMonitor] refresh error:', err)
    }
  }

  private snapshotEqual(a: CodexSession[], b: CodexSession[]): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (
        a[i].id !== b[i].id ||
        a[i].state !== b[i].state ||
        a[i].lastActivity !== b[i].lastActivity
      ) {
        return false
      }
    }
    return true
  }
}

export const codexMonitor = new CodexMonitor()

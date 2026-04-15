/**
 * CodexSqliteAdapter — wraps CodexMonitor for the adapter interface.
 *
 * Read-only: canDispatch = false. No send/abort.
 * snapshot() returns Codex CLI sessions normalized as NormalizedProject[].
 */
import { EventEmitter } from 'events'
import { CodexMonitor } from './monitor'
import type { Adapter, AdapterSnapshot } from '../types'
import type { NormalizedProject } from '../opencode-http/types'
import type { CodexSession } from './types'
import { configStore } from '../../config/store'

export class CodexSqliteAdapter extends EventEmitter implements Adapter {
  readonly id = 'codex-sqlite'
  readonly label = 'CodexSQLite'
  readonly canDispatch = false

  private monitor: CodexMonitor

  constructor(monitor: CodexMonitor) {
    super()
    this.monitor = monitor
    monitor.on('change', () => this.emit('change'))
  }

  start(): void {
    const cfg = configStore.get()
    if (cfg.mock.enabled) return
    this.monitor.start()
  }

  dispose(): void {
    this.monitor.dispose()
    this.removeAllListeners()
  }

  snapshot(): AdapterSnapshot {
    const { sessions } = this.monitor.getSnapshot()
    const projects = this.normalizeCodexSessions(sessions)
    return {
      projects,
      status: 'disabled',
      perInstance: []
    }
  }

  getMonitor(): CodexMonitor {
    return this.monitor
  }

  private normalizeCodexSessions(sessions: CodexSession[]): NormalizedProject[] {
    const byPath = new Map<string, CodexSession[]>()
    for (const s of sessions) {
      const list = byPath.get(s.cwd) ?? []
      list.push(s)
      byPath.set(s.cwd, list)
    }

    const projects: NormalizedProject[] = []
    for (const [cwd, cwdSessions] of byPath) {
      const normalized = cwdSessions.map((s) => ({
        id: s.id,
        agentType: 'codex' as const,
        state: s.state as 'running' | 'idle',
        currentAction: s.state === 'running' ? '⚙ running…' : '◌ idle',
        startedAt: s.startedAt,
        lastActivity: s.lastActivity,
        projectId: cwd,
        instanceKey: `codex:${s.id}`,
        pendingPermission: null
      }))

      const name = cwd.split('/').filter(Boolean).pop() ?? cwd
      projects.push({ id: cwd, name, path: cwd, sessions: normalized })
    }

    return projects
  }
}

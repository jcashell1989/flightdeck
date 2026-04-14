/**
 * ClaudeFileWatchAdapter — wraps ClaudeMonitor for the adapter interface.
 *
 * Read-only: canDispatch = false. No send/abort.
 * snapshot() returns claude sessions normalized as NormalizedProject[].
 * All sessions have controlMode = 'watched'.
 */
import { EventEmitter } from 'events'
import { ClaudeMonitor } from './monitor'
import type { Adapter, AdapterSnapshot } from '../types'
import type { NormalizedProject } from '../opencode-http/types'
import type { ClaudeProject } from './types'
import { configStore } from '../../config/store'

export class ClaudeFileWatchAdapter extends EventEmitter implements Adapter {
  readonly id = 'claude-file-watch'
  readonly label = 'ClaudeFileWatch'
  readonly canDispatch = false

  private monitor: ClaudeMonitor

  constructor(monitor: ClaudeMonitor) {
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

  private normalizeProject(claudeProject: ClaudeProject): NormalizedProject {
    return {
      id: claudeProject.path,
      name: claudeProject.name,
      path: claudeProject.path,
      sessions: claudeProject.sessions.map((s) => ({
        id: s.sessionId,
        agentType: 'claude-code' as const,
        state: s.state as 'running' | 'idle' | 'error',
        currentAction: s.currentAction,
        startedAt: s.startedAt,
        lastActivity: s.lastActivity,
        projectId: claudeProject.path,
        instanceKey: `claude:${s.pid}`,
        pendingPermission: null
      }))
    }
  }
}

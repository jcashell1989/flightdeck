/**
 * AdapterRegistry — owns N Adapter instances, merges their snapshots.
 *
 * Emits 'change' when any adapter emits 'change'.
 * Replaces OpencodeRegistry.
 */
import { EventEmitter } from 'events'
import type { Adapter, AdapterSnapshot, AggregateSnapshot, AggregateStatus, ControlMode, DispatchRequest, CommandDefinition } from './types'
import type { NormalizedProject, InstanceConnectionStatus } from '../opencode/types'
import type { FlightDeckDb, SessionRecord } from '../db/index'

export class AdapterRegistry extends EventEmitter {
  private adapters: Adapter[] = []
  private disposed = false
  private db: FlightDeckDb | null

  /** Historical sessions loaded once at startup — never re-fetched. */
  private historicalOverlay: NormalizedProject[] = []
  /** IDs of historical sessions — used to skip them in persistSnapshot. */
  private historicalIds = new Set<string>()

  private _persistTimer: ReturnType<typeof setTimeout> | null = null

  constructor(db: FlightDeckDb | null = null) {
    super()
    this.db = db
  }

  /** Call once at startup after DB is open to populate the historical overlay. */
  loadHistory(): void {
    if (!this.db) return
    const records = this.db.getRecentSessions()
    const projectMap = new Map<string, NormalizedProject>()
    for (const rec of records) {
      let proj = projectMap.get(rec.projectPath)
      if (!proj) {
        proj = {
          id: rec.projectId,
          name: rec.projectPath.split('/').pop() ?? rec.projectPath,
          path: rec.projectPath,
          sessions: []
        }
        projectMap.set(rec.projectPath, proj)
      }
      proj.sessions.push({
        id: rec.id,
        agentType: rec.agentType as 'opencode' | 'claude-code' | 'codex',
        state: 'idle' as const,
        currentAction: '◌ historical',
        startedAt: rec.startedAt,
        lastActivity: rec.lastActivity,
        projectId: rec.projectId,
        instanceKey: 'historical',
      })
      this.historicalIds.add(rec.id)
    }
    this.historicalOverlay = Array.from(projectMap.values())
  }

  register(adapter: Adapter): void {
    this.adapters.push(adapter)
    adapter.on('change', () => {
      this.emit('change')
      this.schedulePersist()
    })
  }

  private schedulePersist(): void {
    if (!this.db || this.disposed) return
    if (this._persistTimer) clearTimeout(this._persistTimer)
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null
      this.flushPersist()
    }, 500)
  }

  private flushPersist(): void {
    if (!this.db || this.disposed) return
    const snap = this.snapshot()
    // Collect live session IDs — skip historical rows (they're in historicalIds).
    const liveSessionIds = new Set<string>()
    for (const p of snap.projects) {
      for (const s of p.sessions) {
        if (!this.historicalIds.has(s.id)) liveSessionIds.add(s.id)
      }
    }
    // Batch all upserts in a single transaction.
    try {
      this.db.exec('BEGIN')
      for (const p of snap.projects) {
        for (const s of p.sessions) {
          if (!liveSessionIds.has(s.id)) continue // skip historical
          this.db.upsertSession({
            id: s.id,
            agentType: s.agentType,
            projectId: p.id ?? p.path,
            projectPath: p.path,
            state: s.state,
            startedAt: s.startedAt,
            lastActivity: s.lastActivity
          } as SessionRecord)
        }
      }
      this.db.exec('COMMIT')
    } catch (err) {
      try { this.db.exec('ROLLBACK') } catch { /* ignore */ }
      console.warn('[AdapterRegistry] persistSnapshot error:', err)
    }
  }

  start(): void {
    for (const a of this.adapters) a.start()
  }

  dispose(): void {
    this.disposed = true
    if (this._persistTimer) { clearTimeout(this._persistTimer); this._persistTimer = null }
    for (const a of this.adapters) a.dispose()
    this.removeAllListeners()
  }

  snapshot(): AggregateSnapshot {
    const projects: NormalizedProject[] = []
    const perInstance: AggregateStatus['perInstance'] = []

    // Collect each adapter's snapshot once — reused for dedup and stamping.
    const adapterSnaps: Array<[Adapter, AdapterSnapshot]> = this.adapters.map((a) => [a, a.snapshot()])

    for (const [, snap] of adapterSnaps) {
      perInstance.push(...snap.perInstance)

      for (const p of snap.projects) {
        const existing = projects.find((ep) => ep.path === p.path)
        if (existing) {
          const existingIds = new Set(existing.sessions.map((s) => s.id))
          existing.sessions.push(...p.sessions.filter((s) => !existingIds.has(s.id)))
        } else {
          projects.push({ ...p, sessions: [...p.sessions] })
        }
      }
    }

    // Final defensive pass: ensure session IDs are globally unique.
    const seenSessionIds = new Set<string>()
    const dedupedProjects = projects
      .map((p) => ({
        ...p,
        sessions: p.sessions.filter((s) => {
          if (seenSessionIds.has(s.id)) return false
          seenSessionIds.add(s.id)
          return true
        })
      }))
      .filter((p) => p.sessions.length > 0)

    // Build sessionId → adapter map from already-collected snapshots.
    const adapterBySession = new Map<string, Adapter>()
    for (const [adapter, snap] of adapterSnaps) {
      for (const p of snap.projects) {
        for (const s of p.sessions) {
          if (!adapterBySession.has(s.id)) adapterBySession.set(s.id, adapter)
        }
      }
    }

    // Stamp adapterId / controlMode / canReply / canAbort / canCommand on each session.
    const stampedProjects = dedupedProjects.map((p) => ({
      ...p,
      sessions: p.sessions.map((s) => {
        const a = adapterBySession.get(s.id)
        if (!a) return s
        const controlMode: ControlMode = a.canDispatch ? 'managed' : 'watched'
        const canReply = typeof a.send === 'function' ? true : undefined
        const canAbort = typeof a.abort === 'function' ? true : undefined
        const canCommand = typeof a.sendCommand === 'function' ? true : undefined
        return {
          ...s,
          adapterId: a.id,
          controlMode,
          ...(canReply !== undefined ? { canReply } : {}),
          ...(canAbort !== undefined ? { canAbort } : {}),
          ...(canCommand !== undefined ? { canCommand } : {})
        }
      })
    }))

    // Merge historical overlay — sessions not currently live.
    for (const hp of this.historicalOverlay) {
      let proj = stampedProjects.find(p => p.path === hp.path)
      if (!proj) {
        proj = { ...hp, sessions: [] }
        stampedProjects.push(proj)
      }
      for (const hs of hp.sessions) {
        if (!seenSessionIds.has(hs.id)) {
          proj.sessions.push(hs)
          seenSessionIds.add(hs.id)
        }
      }
    }

    return {
      projects: stampedProjects,
      aggregateStatus: {
        status: this.deriveAggregate(perInstance),
        perInstance
      }
    }
  }

  /** Find the adapter that owns a given sessionId (linear scan — N is small). */
  findAdapterForSession(sessionId: string): Adapter | null {
    for (const a of this.adapters) {
      const snap = a.snapshot()
      for (const p of snap.projects) {
        if (p.sessions.some((s) => s.id === sessionId)) return a
      }
    }
    return null
  }

  /** Find a dispatchable adapter for a given profileId. */
  findAdapterForDispatch(profileId: string): Adapter | null {
    // Return first adapter that can dispatch; profileId routing can be
    // extended here in Phase 10 when we have per-adapter profile affinity.
    return this.adapters.find((a) => a.canDispatch && a.dispatch) ?? null
  }

  // ── Convenience pass-throughs ────────────────────────────────────────────

  async send(sessionId: string, text: string): Promise<void> {
    const a = this.findAdapterForSession(sessionId)
    if (!a?.send) throw new Error(`no adapter can send to session ${sessionId}`)
    return a.send(sessionId, text)
  }

  async sendCommand(sessionId: string, command: string, args: string): Promise<{ ok: boolean }> {
    const a = this.findAdapterForSession(sessionId)
    if (!a?.sendCommand) throw new Error(`no adapter can sendCommand to session ${sessionId}`)
    return a.sendCommand(sessionId, command, args)
  }

  async listCommands(sessionId: string): Promise<CommandDefinition[]> {
    const a = this.findAdapterForSession(sessionId)
    if (!a?.listCommands) return []
    return a.listCommands(sessionId)
  }

  async abort(sessionId: string): Promise<void> {
    const a = this.findAdapterForSession(sessionId)
    if (!a?.abort) throw new Error(`no adapter can abort session ${sessionId}`)
    return a.abort(sessionId)
  }

  async respondPermission(
    sessionId: string,
    permissionId: string,
    response: 'once' | 'always' | 'reject'
  ): Promise<void> {
    const a = this.findAdapterForSession(sessionId)
    if (!a?.respondPermission) throw new Error(`no adapter can respond to permission for session ${sessionId}`)
    return a.respondPermission(sessionId, permissionId, response)
  }

  async fetchMessages(sessionId: string): Promise<Array<{ info: unknown; parts: unknown[] }>> {
    const a = this.findAdapterForSession(sessionId)
    if (!a?.fetchMessages) return []
    return a.fetchMessages(sessionId)
  }

  async dispatch(req: DispatchRequest): Promise<{ sessionId: string }> {
    const a = this.findAdapterForDispatch(req.profileId)
    if (!a?.dispatch) throw new Error(`no adapter can dispatch for profile ${req.profileId}`)
    return a.dispatch(req)
  }

  private deriveAggregate(
    perInstance: AggregateStatus['perInstance']
  ): AggregateStatus['status'] {
    if (perInstance.length === 0) return 'disabled'
    const statuses = perInstance.map((i) => i.status) as InstanceConnectionStatus[]
    if (statuses.some((s) => s === 'error')) return 'error'
    if (statuses.some((s) => s === 'reconnecting')) return 'reconnecting'
    if (statuses.some((s) => s === 'connecting')) return 'connecting'
    return 'connected'
  }
}

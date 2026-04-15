import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { AdapterRegistry } from './registry'
import type { Adapter, AdapterSnapshot } from './types'
import type { SessionRecord } from '../db'

class FakeAdapter extends EventEmitter implements Adapter {
  id: string
  label: string
  canDispatch: boolean
  private snap: AdapterSnapshot
  send?: (sessionId: string, text: string) => Promise<void>
  abort?: (sessionId: string) => Promise<void>
  sendCommand?: (sessionId: string, command: string, args: string) => Promise<{ ok: boolean }>

  constructor(id: string, snap: AdapterSnapshot, canDispatch = false) {
    super()
    this.id = id
    this.label = id
    this.canDispatch = canDispatch
    this.snap = snap
  }

  setSnapshot(snap: AdapterSnapshot): void {
    this.snap = snap
  }

  start(): void {}
  dispose(): void {}
  snapshot(): AdapterSnapshot { return this.snap }
}

function session(id: string, state: 'running' | 'idle' | 'approval' | 'question' | 'error' = 'idle') {
  return {
    id,
    agentType: 'opencode' as const,
    state,
    currentAction: 'waiting',
    startedAt: 1,
    lastActivity: 2,
    projectId: 'proj-1',
    instanceKey: 'inst-1',
  }
}

function project(path: string, sessions: ReturnType<typeof session>[]) {
  return {
    id: path,
    name: path.split('/').pop() ?? path,
    path,
    sessions,
  }
}

function snapshot(
  projects: Array<ReturnType<typeof project>>,
  perInstance: AdapterSnapshot['perInstance'] = [{ key: 'inst-1', status: 'connected', lastError: null }],
): AdapterSnapshot {
  return { projects, status: 'connected', perInstance }
}

describe('AdapterRegistry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses aggregate status precedence error > reconnecting > connecting > connected', () => {
    const registry = new AdapterRegistry()
    registry.register(new FakeAdapter('a', snapshot([], [{ key: 'a', status: 'connected', lastError: null }])))
    registry.register(new FakeAdapter('b', snapshot([], [{ key: 'b', status: 'connecting', lastError: null }])))
    expect(registry.snapshot().aggregateStatus.status).toBe('connecting')

    registry.register(new FakeAdapter('c', snapshot([], [{ key: 'c', status: 'reconnecting', lastError: null }])))
    expect(registry.snapshot().aggregateStatus.status).toBe('reconnecting')

    registry.register(new FakeAdapter('d', snapshot([], [{ key: 'd', status: 'error', lastError: 'boom' }])))
    expect(registry.snapshot().aggregateStatus.status).toBe('error')
  })

  it('merges projects by path and globally dedups duplicate session ids', () => {
    const registry = new AdapterRegistry()
    const adapterA = new FakeAdapter('a', snapshot([
      project('/work/repo-a', [session('s-1'), session('s-2')]),
      project('/work/repo-b', [session('s-3')]),
    ]))
    const adapterB = new FakeAdapter('b', snapshot([
      project('/work/repo-a', [session('s-2'), session('s-4')]),
      project('/work/repo-c', [session('s-1')]),
    ]))
    registry.register(adapterA)
    registry.register(adapterB)

    const snap = registry.snapshot()
    const allIds = snap.projects.flatMap((p) => p.sessions.map((s) => s.id))
    expect(new Set(allIds).size).toBe(allIds.length)

    const repoA = snap.projects.find((p) => p.path === '/work/repo-a')
    expect(repoA?.sessions.map((s) => s.id).sort()).toEqual(['s-1', 's-2', 's-4'])
    expect(snap.projects.some((p) => p.path === '/work/repo-c' && p.sessions.some((s) => s.id === 's-1'))).toBe(false)
  })

  it('stamps adapter ownership and capability flags from the owning adapter', () => {
    const registry = new AdapterRegistry()
    const managed = new FakeAdapter('managed', snapshot([project('/work/repo', [session('s-managed')])]), true)
    managed.send = vi.fn(async () => {})
    managed.abort = vi.fn(async () => {})
    const watched = new FakeAdapter('watched', snapshot([project('/work/repo', [session('s-watched')])]), false)
    watched.sendCommand = vi.fn(async () => ({ ok: true }))

    registry.register(managed)
    registry.register(watched)

    const sessions = registry.snapshot().projects.flatMap((p) => p.sessions)
    const managedSession = sessions.find((s) => s.id === 's-managed')
    const watchedSession = sessions.find((s) => s.id === 's-watched')

    expect(managedSession).toMatchObject({
      adapterId: 'managed',
      controlMode: 'managed',
      canReply: true,
      canAbort: true,
    })
    expect((managedSession as { canCommand?: boolean }).canCommand).toBeUndefined()

    expect(watchedSession).toMatchObject({
      adapterId: 'watched',
      controlMode: 'watched',
      canCommand: true,
    })
    expect((watchedSession as { canReply?: boolean }).canReply).toBeUndefined()
  })

  it('persists only live sessions during debounced change flush', () => {
    const upserts: SessionRecord[] = []
    const execs: string[] = []
    const db = {
      getRecentSessions: vi.fn(() => [{
        id: 'historical-1',
        agentType: 'opencode',
        projectId: 'proj-h',
        projectPath: '/work/repo',
        state: 'idle',
        startedAt: 10,
        lastActivity: 20,
      }]),
      upsertSession: vi.fn((record: SessionRecord) => { upserts.push(record) }),
      exec: vi.fn((sql: string) => { execs.push(sql) }),
    }

    const registry = new AdapterRegistry(db as never)
    registry.loadHistory()

    const adapter = new FakeAdapter('live', snapshot([
      project('/work/repo', [session('live-1'), session('historical-1')]),
    ]))
    registry.register(adapter)
    adapter.emit('change')
    vi.runAllTimers()

    expect(execs).toContain('BEGIN')
    expect(execs).toContain('COMMIT')
    expect(upserts.map((u) => u.id)).toEqual(['live-1'])
  })
})

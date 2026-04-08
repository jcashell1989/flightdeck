import { describe, it, expect, beforeEach } from 'vitest'
import {
  initialSessionState,
  applyEvent,
  groupIntoProjects,
  deriveState,
  InternalSessionState
} from './mapper'
import type { Session as SdkSession } from '@opencode-ai/sdk'

// ── Fixtures ──────────────────────────────────────────────────────────────

function makeSdkSession(overrides: Partial<SdkSession> = {}): SdkSession {
  return {
    id: 'sess-001',
    title: 'test session',
    directory: '/projects/auth',
    time: { created: 1000, updated: 2000 },
    ...overrides
  } as SdkSession
}

function makeState(overrides: Partial<InternalSessionState> = {}): InternalSessionState {
  return {
    ...initialSessionState(makeSdkSession()),
    ...overrides
  }
}

// ── initialSessionState ───────────────────────────────────────────────────

describe('initialSessionState', () => {
  it('sets sdkStatus to idle', () => {
    const s = initialSessionState(makeSdkSession())
    expect(s.sdkStatus).toEqual({ type: 'idle' })
  })

  it('sets lastActivity from time.updated', () => {
    const s = initialSessionState(makeSdkSession({ time: { created: 100, updated: 999 } }))
    expect(s.lastActivity).toBe(999)
  })

  it('falls back to time.created when updated is null', () => {
    const s = initialSessionState(makeSdkSession({ time: { created: 500, updated: null as unknown as number } }))
    expect(s.lastActivity).toBe(500)
  })

  it('sets currentAction from title', () => {
    const s = initialSessionState(makeSdkSession({ title: 'my task' }))
    expect(s.currentAction).toBe('my task')
  })

  it('falls back to "waiting" when title is empty', () => {
    const s = initialSessionState(makeSdkSession({ title: '' }))
    expect(s.currentAction).toBe('waiting')
  })
})

// ── deriveState ───────────────────────────────────────────────────────────

describe('deriveState', () => {
  it('returns error when lastError is set', () => {
    const s = makeState({ lastError: 'boom' })
    expect(deriveState(s)).toBe('error')
  })

  it('returns approval when pendingPermissions is non-empty', () => {
    const s = makeState()
    s.pendingPermissions.set('perm-1', { id: 'perm-1' } as never)
    expect(deriveState(s)).toBe('approval')
  })

  it('error takes precedence over approval', () => {
    const s = makeState({ lastError: 'boom' })
    s.pendingPermissions.set('perm-1', { id: 'perm-1' } as never)
    expect(deriveState(s)).toBe('error')
  })

  it('returns running for busy status', () => {
    const s = makeState({ sdkStatus: { type: 'busy' } as never })
    expect(deriveState(s)).toBe('running')
  })

  it('returns running for retry status', () => {
    const s = makeState({ sdkStatus: { type: 'retry' } as never })
    expect(deriveState(s)).toBe('running')
  })

  it('returns idle for idle status', () => {
    const s = makeState({ sdkStatus: { type: 'idle' } })
    expect(deriveState(s)).toBe('idle')
  })
})

// ── applyEvent ────────────────────────────────────────────────────────────

describe('applyEvent', () => {
  let states: Map<string, InternalSessionState>

  beforeEach(() => {
    states = new Map()
    states.set('sess-001', makeState())
  })

  it('session.updated: updates existing session meta', () => {
    const updated = makeSdkSession({ title: 'updated title', time: { created: 1000, updated: 3000 } })
    const mutated = applyEvent(states, {
      type: 'session.updated',
      properties: { info: updated }
    } as never)
    expect(mutated).toBe(true)
    expect(states.get('sess-001')!.meta.title).toBe('updated title')
    expect(states.get('sess-001')!.lastActivity).toBe(3000)
  })

  it('session.updated: creates new session if not found', () => {
    const newSession = makeSdkSession({ id: 'sess-new' })
    applyEvent(states, { type: 'session.updated', properties: { info: newSession } } as never)
    expect(states.has('sess-new')).toBe(true)
  })

  it('session.deleted: removes session and returns true', () => {
    const mutated = applyEvent(states, {
      type: 'session.deleted',
      properties: { info: makeSdkSession() }
    } as never)
    expect(mutated).toBe(true)
    expect(states.has('sess-001')).toBe(false)
  })

  it('session.deleted: returns false for unknown session', () => {
    const mutated = applyEvent(states, {
      type: 'session.deleted',
      properties: { info: makeSdkSession({ id: 'unknown' }) }
    } as never)
    expect(mutated).toBe(false)
  })

  it('session.status: updates sdkStatus', () => {
    applyEvent(states, {
      type: 'session.status',
      properties: { sessionID: 'sess-001', status: { type: 'busy' } }
    } as never)
    expect(states.get('sess-001')!.sdkStatus).toEqual({ type: 'busy' })
  })

  it('session.status: returns false for unknown session', () => {
    const mutated = applyEvent(states, {
      type: 'session.status',
      properties: { sessionID: 'unknown', status: { type: 'busy' } }
    } as never)
    expect(mutated).toBe(false)
  })

  it('session.idle: sets sdkStatus to idle', () => {
    states.get('sess-001')!.sdkStatus = { type: 'busy' } as never
    applyEvent(states, {
      type: 'session.idle',
      properties: { sessionID: 'sess-001' }
    } as never)
    expect(states.get('sess-001')!.sdkStatus).toEqual({ type: 'idle' })
  })

  it('session.error: sets lastError', () => {
    applyEvent(states, {
      type: 'session.error',
      properties: { sessionID: 'sess-001', error: { message: 'timeout' } }
    } as never)
    expect(states.get('sess-001')!.lastError).toBe('timeout')
  })

  it('session.error: returns false when sessionID missing', () => {
    const mutated = applyEvent(states, {
      type: 'session.error',
      properties: {}
    } as never)
    expect(mutated).toBe(false)
  })

  it('permission.updated: adds permission to pendingPermissions', () => {
    applyEvent(states, {
      type: 'permission.updated',
      properties: { id: 'perm-1', sessionID: 'sess-001', type: 'bash', title: 'run npm test' }
    } as never)
    expect(states.get('sess-001')!.pendingPermissions.has('perm-1')).toBe(true)
  })

  it('permission.replied: removes permission', () => {
    states.get('sess-001')!.pendingPermissions.set('perm-1', { id: 'perm-1' } as never)
    const mutated = applyEvent(states, {
      type: 'permission.replied',
      properties: { sessionID: 'sess-001', permissionID: 'perm-1' }
    } as never)
    expect(mutated).toBe(true)
    expect(states.get('sess-001')!.pendingPermissions.has('perm-1')).toBe(false)
  })

  it('permission.replied: returns false when permission not found', () => {
    const mutated = applyEvent(states, {
      type: 'permission.replied',
      properties: { sessionID: 'sess-001', permissionID: 'nonexistent' }
    } as never)
    expect(mutated).toBe(false)
  })

  it('message.part.updated: updates currentAction', () => {
    applyEvent(states, {
      type: 'message.part.updated',
      properties: {
        part: { type: 'text', text: 'hello world', sessionID: 'sess-001' }
      }
    } as never)
    expect(states.get('sess-001')!.currentAction).toBe('hello world')
  })

  it('unknown event type: returns false', () => {
    const mutated = applyEvent(states, { type: 'unknown.event', properties: {} } as never)
    expect(mutated).toBe(false)
  })
})

// ── groupIntoProjects ─────────────────────────────────────────────────────

describe('groupIntoProjects', () => {
  const instance = { host: '127.0.0.1', port: 4096 }

  it('groups sessions by directory', () => {
    const s1 = makeState()
    const s2 = makeState()
    s2.meta = makeSdkSession({ id: 'sess-002', directory: '/projects/api' })

    const projects = groupIntoProjects([s1, s2], instance)
    expect(projects).toHaveLength(2)
    const dirs = projects.map((p) => p.path).sort()
    expect(dirs).toEqual(['/projects/api', '/projects/auth'])
  })

  it('puts multiple sessions in the same project when same directory', () => {
    const s1 = makeState()
    const s2 = makeState()
    s2.meta = makeSdkSession({ id: 'sess-002' }) // same directory as s1

    const projects = groupIntoProjects([s1, s2], instance)
    expect(projects).toHaveLength(1)
    expect(projects[0].sessions).toHaveLength(2)
  })

  it('sets project name to last path segment', () => {
    const projects = groupIntoProjects([makeState()], instance)
    expect(projects[0].name).toBe('auth')
  })

  it('sets instanceKey on sessions', () => {
    const projects = groupIntoProjects([makeState()], instance)
    expect(projects[0].sessions[0].instanceKey).toBe('127.0.0.1:4096')
  })

  it('returns empty array for empty input', () => {
    expect(groupIntoProjects([], instance)).toEqual([])
  })
})

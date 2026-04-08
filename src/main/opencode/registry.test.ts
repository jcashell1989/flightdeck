import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import type { NormalizedProject, InstanceSnapshot } from './types'
import type { ClaudeProject } from '../claude/types'

// ── Mock OpencodeInstanceClient ───────────────────────────────────────────
// vi.hoisted runs before vi.mock hoisting, so the class is available in the factory.

const { MockOpencodeInstanceClient } = vi.hoisted(() => {
  const { EventEmitter } = require('events') as typeof import('events')
  class MockOpencodeInstanceClient extends EventEmitter {
    connect = vi.fn().mockResolvedValue(undefined)
    dispose = vi.fn()
    hasSession = vi.fn().mockReturnValue(false)
    snapshot = vi.fn().mockReturnValue({
      instance: { host: '127.0.0.1', port: 4096 },
      status: 'connected' as const,
      lastError: null,
      projects: []
    })
  }
  return { MockOpencodeInstanceClient }
})

vi.mock('./client', () => ({
  OpencodeInstanceClient: MockOpencodeInstanceClient
}))

// ── Mock configStore ──────────────────────────────────────────────────────

const { mockConfigGet } = vi.hoisted(() => ({
  mockConfigGet: vi.fn().mockReturnValue({
    opencode: { instances: [{ host: '127.0.0.1', port: 4096 }] },
    mock: { enabled: false },
    projects: [],
    profiles: []
  })
}))

vi.mock('../config/store', () => ({
  configStore: {
    get: mockConfigGet,
    on: vi.fn(),
    off: vi.fn()
  }
}))

import { OpencodeRegistry } from './registry'

// ── Helpers ───────────────────────────────────────────────────────────────

function makeClaudeProject(path: string): ClaudeProject {
  return {
    encodedPath: path.replace(/\//g, '-').replace(/^-/, ''),
    path,
    name: path.split('/').pop() ?? path,
    sessions: [
      {
        sessionId: 'claude-sess-1',
        pid: 9999,
        cwd: path,
        startedAt: 1000,
        state: 'running',
        currentAction: '⚙ working…',
        lastActivity: 2000
      }
    ]
  }
}

function makeOpenCodeProject(path: string): NormalizedProject {
  return {
    id: `proj:${path}`,
    name: path.split('/').pop() ?? path,
    path,
    sessions: [
      {
        id: 'oc-sess-1',
        agentType: 'opencode',
        state: 'idle',
        currentAction: '◌ idle',
        startedAt: 500,
        lastActivity: 1500,
        projectId: `proj:${path}`,
        instanceKey: '127.0.0.1:4096'
      }
    ]
  }
}

// ── deriveAggregate ───────────────────────────────────────────────────────

describe('OpencodeRegistry — deriveAggregate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConfigGet.mockReturnValue({
      opencode: { instances: [{ host: '127.0.0.1', port: 4096 }] },
      mock: { enabled: false },
      projects: [],
      profiles: []
    })
  })

  it('returns disabled when no clients exist', () => {
    const registry = new OpencodeRegistry()
    // Don't call start() — no clients
    expect(registry.snapshot().aggregateStatus.status).toBe('disabled')
  })

  it('returns connected when all instances are connected', () => {
    const registry = new OpencodeRegistry()
    registry.start()
    expect(registry.snapshot().aggregateStatus.status).toBe('connected')
    registry.dispose()
  })

  it('returns error when instance has error status', () => {
    const registry = new OpencodeRegistry()
    registry.start()
    // Grab the created client and override its snapshot
    const clients = registry.listClients()
    expect(clients).toHaveLength(1)
    clients[0].client.snapshot.mockReturnValue({
      instance: { host: '127.0.0.1', port: 4096 },
      status: 'error',
      lastError: 'connection refused',
      projects: []
    })
    expect(registry.snapshot().aggregateStatus.status).toBe('error')
    registry.dispose()
  })

  it('returns reconnecting when instance is reconnecting', () => {
    const registry = new OpencodeRegistry()
    registry.start()
    const clients = registry.listClients()
    clients[0].client.snapshot.mockReturnValue({
      instance: { host: '127.0.0.1', port: 4096 },
      status: 'reconnecting',
      lastError: null,
      projects: []
    })
    expect(registry.snapshot().aggregateStatus.status).toBe('reconnecting')
    registry.dispose()
  })

  it('error beats reconnecting (worst-of-N precedence)', () => {
    mockConfigGet.mockReturnValue({
      opencode: {
        instances: [
          { host: '127.0.0.1', port: 4096 },
          { host: '127.0.0.1', port: 4097 }
        ]
      },
      mock: { enabled: false },
      projects: [],
      profiles: []
    })
    const registry = new OpencodeRegistry()
    registry.start()
    const clients = registry.listClients()
    expect(clients).toHaveLength(2)
    clients[0].client.snapshot.mockReturnValue({
      instance: { host: '127.0.0.1', port: 4096 },
      status: 'error',
      lastError: 'err',
      projects: []
    })
    clients[1].client.snapshot.mockReturnValue({
      instance: { host: '127.0.0.1', port: 4097 },
      status: 'reconnecting',
      lastError: null,
      projects: []
    })
    expect(registry.snapshot().aggregateStatus.status).toBe('error')
    registry.dispose()
  })
})

// ── Claude Code session merging ───────────────────────────────────────────

describe('OpencodeRegistry — Claude Code session merging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConfigGet.mockReturnValue({
      opencode: { instances: [{ host: '127.0.0.1', port: 4096 }] },
      mock: { enabled: false },
      projects: [],
      profiles: []
    })
  })

  it('appends Claude Code sessions to an existing opencode project with the same path', () => {
    const registry = new OpencodeRegistry()
    registry.start()

    const clients = registry.listClients()
    clients[0].client.snapshot.mockReturnValue({
      instance: { host: '127.0.0.1', port: 4096 },
      status: 'connected',
      lastError: null,
      projects: [makeOpenCodeProject('/projects/auth')]
    })

    const mockMonitor = {
      on: vi.fn(),
      getSnapshot: vi.fn().mockReturnValue({
        projects: [makeClaudeProject('/projects/auth')]
      })
    }
    registry.setClaudeMonitor(mockMonitor as never)

    const snap = registry.snapshot()
    const authProject = snap.projects.find((p) => p.path === '/projects/auth')
    expect(authProject).toBeDefined()
    expect(authProject!.sessions).toHaveLength(2)
    expect(authProject!.sessions.some((s) => s.agentType === 'claude-code')).toBe(true)
    expect(authProject!.sessions.some((s) => s.agentType === 'opencode')).toBe(true)
    registry.dispose()
  })

  it('creates a new project entry for a Claude Code project with no opencode counterpart', () => {
    const registry = new OpencodeRegistry()
    registry.start()

    const mockMonitor = {
      on: vi.fn(),
      getSnapshot: vi.fn().mockReturnValue({
        projects: [makeClaudeProject('/projects/standalone')]
      })
    }
    registry.setClaudeMonitor(mockMonitor as never)

    const snap = registry.snapshot()
    const standaloneProject = snap.projects.find((p) => p.path === '/projects/standalone')
    expect(standaloneProject).toBeDefined()
    expect(standaloneProject!.sessions[0].agentType).toBe('claude-code')
    registry.dispose()
  })
})

// ── findClientForSession ──────────────────────────────────────────────────

describe('OpencodeRegistry — findClientForSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConfigGet.mockReturnValue({
      opencode: { instances: [{ host: '127.0.0.1', port: 4096 }] },
      mock: { enabled: false },
      projects: [],
      profiles: []
    })
  })

  it('returns null when no clients exist', () => {
    const registry = new OpencodeRegistry()
    expect(registry.findClientForSession('sess-x')).toBeNull()
  })

  it('returns the client that owns the session', () => {
    const registry = new OpencodeRegistry()
    registry.start()
    const clients = registry.listClients()
    clients[0].client.hasSession.mockImplementation((id: string) => id === 'sess-owned')

    expect(registry.findClientForSession('sess-owned')).not.toBeNull()
    expect(registry.findClientForSession('sess-other')).toBeNull()
    registry.dispose()
  })
})

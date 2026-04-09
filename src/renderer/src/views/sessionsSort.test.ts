import { describe, it, expect } from 'vitest'
import { compareBy, FlatSession } from './sessionsSort'

function make(overrides: Partial<FlatSession>): FlatSession {
  return {
    id: 'ses_aaaa',
    agentType: 'opencode',
    state: 'running',
    currentAction: 'compiling',
    startedAt: 0,
    lastActivity: 1000,
    projectId: 'proj_alpha',
    projectName: 'alpha',
    ...overrides
  }
}

describe('compareBy', () => {
  it('sorts by status label', () => {
    const a = make({ state: 'running' }) // "Running"
    const b = make({ state: 'error' })   // "Error"
    expect(compareBy(a, b, 'status')).toBeGreaterThan(0)
    expect(compareBy(b, a, 'status')).toBeLessThan(0)
  })

  it('sorts by agent type lexicographically', () => {
    const a = make({ agentType: 'claude-code' })
    const b = make({ agentType: 'opencode' })
    expect(compareBy(a, b, 'agent')).toBeLessThan(0)
  })

  it('sorts by id', () => {
    const a = make({ id: 'ses_aaaa' })
    const b = make({ id: 'ses_bbbb' })
    expect(compareBy(a, b, 'id')).toBeLessThan(0)
  })

  it('sorts by project name', () => {
    const a = make({ projectName: 'alpha' })
    const b = make({ projectName: 'bravo' })
    expect(compareBy(a, b, 'project')).toBeLessThan(0)
  })

  it('sorts by action, treating null as empty string', () => {
    const a = make({ currentAction: null as unknown as string })
    const b = make({ currentAction: 'running tests' })
    expect(compareBy(a, b, 'action')).toBeLessThan(0)
  })

  it('sorts by activity timestamp numerically (ascending)', () => {
    const a = make({ lastActivity: 500 })
    const b = make({ lastActivity: 1000 })
    expect(compareBy(a, b, 'activity')).toBeLessThan(0)
    expect(compareBy(b, a, 'activity')).toBeGreaterThan(0)
    expect(compareBy(a, a, 'activity')).toBe(0)
  })
})

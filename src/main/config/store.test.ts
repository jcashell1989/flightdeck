import { describe, it, expect, vi, beforeEach } from 'vitest'
import { validatePatch } from './store'

// ── validatePatch ─────────────────────────────────────────────────────────
// We test validatePatch in isolation — it has no Electron dependency.
// ConfigStore itself requires app.getPath and safeStorage which are only
// available inside a running Electron process; those paths are covered by
// the integration smoke test described in structure.md.

describe('validatePatch', () => {
  it('accepts an empty patch object', () => {
    expect(() => validatePatch({})).not.toThrow()
  })

  it('rejects null', () => {
    expect(() => validatePatch(null)).toThrow('must be a plain object')
  })

  it('rejects an array', () => {
    expect(() => validatePatch([])).toThrow('must be a plain object')
  })

  it('rejects a non-object primitive', () => {
    expect(() => validatePatch('string')).toThrow('must be a plain object')
  })

  // ── opencode ──────────────────────────────────────────────────────────

  it('accepts a valid opencode patch', () => {
    expect(() =>
      validatePatch({ opencode: { instances: [{ host: '127.0.0.1', port: 4096 }] } })
    ).not.toThrow()
  })

  it('accepts opencode with optional label', () => {
    expect(() =>
      validatePatch({ opencode: { instances: [{ host: '127.0.0.1', port: 4096, label: 'local' }] } })
    ).not.toThrow()
  })

  it('rejects opencode.instances that is not an array', () => {
    expect(() => validatePatch({ opencode: { instances: 'bad' } })).toThrow(
      'opencode.instances must be an array'
    )
  })

  it('rejects instance with non-string host', () => {
    expect(() =>
      validatePatch({ opencode: { instances: [{ host: 123, port: 4096 }] } })
    ).toThrow('host must be a string')
  })

  it('rejects instance with non-number port', () => {
    expect(() =>
      validatePatch({ opencode: { instances: [{ host: '127.0.0.1', port: '4096' }] } })
    ).toThrow('port must be a number')
  })

  // ── mock ──────────────────────────────────────────────────────────────

  it('accepts a valid mock patch', () => {
    expect(() => validatePatch({ mock: { enabled: false } })).not.toThrow()
  })

  it('rejects mock.enabled that is not boolean', () => {
    expect(() => validatePatch({ mock: { enabled: 1 } })).toThrow(
      'mock.enabled must be a boolean'
    )
  })

  // ── projects ──────────────────────────────────────────────────────────

  it('accepts a valid projects patch', () => {
    expect(() =>
      validatePatch({ projects: [{ path: '/foo/bar', archived: false }] })
    ).not.toThrow()
  })

  it('accepts projects with optional name', () => {
    expect(() =>
      validatePatch({ projects: [{ path: '/foo/bar', name: 'bar', archived: false }] })
    ).not.toThrow()
  })

  it('rejects projects that is not an array', () => {
    expect(() => validatePatch({ projects: {} })).toThrow('projects must be an array')
  })

  it('rejects project with non-string path', () => {
    expect(() => validatePatch({ projects: [{ path: 123, archived: false }] })).toThrow(
      'project path must be a string'
    )
  })

  it('rejects project with non-boolean archived', () => {
    expect(() => validatePatch({ projects: [{ path: '/foo', archived: 'yes' }] })).toThrow(
      'project archived must be a boolean'
    )
  })

  // ── profiles ──────────────────────────────────────────────────────────

  it('accepts a valid profiles patch', () => {
    expect(() =>
      validatePatch({
        profiles: [
          {
            id: 'uuid-1',
            label: 'primary',
            agentType: 'opencode',
            isDefault: true
          }
        ]
      })
    ).not.toThrow()
  })

  it('accepts profile with optional fields', () => {
    expect(() =>
      validatePatch({
        profiles: [
          {
            id: 'uuid-1',
            label: 'primary',
            agentType: 'opencode',
            provider: 'openrouter',
            model: 'kimi-k2.5',
            apiKey: 'sk-or-abc',
            isDefault: false
          }
        ]
      })
    ).not.toThrow()
  })

  it('rejects profiles that is not an array', () => {
    expect(() => validatePatch({ profiles: 'bad' })).toThrow('profiles must be an array')
  })

  it('rejects profile with invalid agentType', () => {
    expect(() =>
      validatePatch({
        profiles: [{ id: 'x', label: 'x', agentType: 'unknown', isDefault: false }]
      })
    ).toThrow('agentType must be opencode or claude-code')
  })

  it('rejects profile with non-boolean isDefault', () => {
    expect(() =>
      validatePatch({
        profiles: [{ id: 'x', label: 'x', agentType: 'opencode', isDefault: 'yes' }]
      })
    ).toThrow('isDefault must be a boolean')
  })

  it('rejects profile with non-string apiKey', () => {
    expect(() =>
      validatePatch({
        profiles: [{ id: 'x', label: 'x', agentType: 'opencode', isDefault: false, apiKey: 123 }]
      })
    ).toThrow('profile apiKey must be a string')
  })

  it('accepts profile with undefined optional fields', () => {
    expect(() =>
      validatePatch({
        profiles: [
          { id: 'x', label: 'x', agentType: 'claude-code', isDefault: false, provider: undefined }
        ]
      })
    ).not.toThrow()
  })

  // ── combined ──────────────────────────────────────────────────────────

  it('accepts a full valid patch', () => {
    expect(() =>
      validatePatch({
        opencode: { instances: [{ host: '127.0.0.1', port: 4096 }] },
        mock: { enabled: false },
        projects: [{ path: '/foo', archived: false }],
        profiles: [{ id: 'x', label: 'x', agentType: 'opencode', isDefault: true }]
      })
    ).not.toThrow()
  })
})

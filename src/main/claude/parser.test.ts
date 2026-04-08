import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseSessionState, encodeProjectPath, decodeProjectPath, projectName } from './parser'
import * as fs from 'fs'

// ── encodeProjectPath / decodeProjectPath ─────────────────────────────────

describe('encodeProjectPath', () => {
  it('encodes a standard absolute path', () => {
    expect(encodeProjectPath('/Users/julian/projects/auth')).toBe(
      'Users-julian-projects-auth'
    )
  })

  it('strips the leading slash (becomes leading dash, then removed)', () => {
    expect(encodeProjectPath('/foo')).toBe('foo')
  })

  it('handles nested paths', () => {
    expect(encodeProjectPath('/a/b/c')).toBe('a-b-c')
  })

  it('matches the actual Claude Code directory naming observed on disk', () => {
    // Verified against ~/.claude/projects/ on this machine
    expect(encodeProjectPath('/Users/julian.hicks/Documents/Personal/agentctl')).toBe(
      'Users-julian.hicks-Documents-Personal-agentctl'
    )
  })
})

describe('decodeProjectPath', () => {
  it('decodes back to an absolute path', () => {
    expect(decodeProjectPath('Users-julian-projects-auth')).toBe(
      '/Users/julian/projects/auth'
    )
  })

  it('round-trips with encodeProjectPath for simple paths', () => {
    // Note: paths with hyphens in segment names are ambiguous — this is a
    // known limitation of Claude Code's encoding scheme.
    const path = '/Users/julian/projects/auth'
    expect(decodeProjectPath(encodeProjectPath(path))).toBe(path)
  })
})

// ── projectName ───────────────────────────────────────────────────────────

describe('projectName', () => {
  it('returns the last path segment', () => {
    expect(projectName('/Users/julian/projects/auth-service')).toBe('auth-service')
  })

  it('handles trailing slash', () => {
    expect(projectName('/Users/julian/projects/auth/')).toBe('auth')
  })

  it('handles root-level path', () => {
    expect(projectName('/auth')).toBe('auth')
  })
})

// ── parseSessionState ─────────────────────────────────────────────────────

// Helper to build a JSONL string from an array of objects
function toJsonl(entries: object[]): string {
  return entries.map((e) => JSON.stringify(e)).join('\n') + '\n'
}

// We mock fs at the module level so parseSessionState uses our fake file data
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    promises: {
      ...actual.promises,
      stat: vi.fn(),
      open: vi.fn()
    }
  }
})

const mockFs = fs.promises as {
  stat: ReturnType<typeof vi.fn>
  open: ReturnType<typeof vi.fn>
}

function setupFakeFile(content: string): void {
  const buf = Buffer.from(content, 'utf8')
  mockFs.stat.mockResolvedValue({ size: buf.length })
  mockFs.open.mockResolvedValue({
    read: vi.fn((_buf: Buffer, offset: number, length: number, position: number) => {
      const slice = buf.slice(position, position + length)
      slice.copy(_buf, offset)
      return Promise.resolve({ bytesRead: slice.length })
    }),
    close: vi.fn().mockResolvedValue(undefined)
  })
}

describe('parseSessionState', () => {
  const FALLBACK_TS = 1000

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns idle for empty file', async () => {
    mockFs.stat.mockResolvedValue({ size: 0 })
    const result = await parseSessionState('/fake/session.jsonl', FALLBACK_TS)
    expect(result).toEqual({ state: 'idle', currentAction: '◌ idle', lastActivity: FALLBACK_TS })
  })

  it('returns null when file cannot be read', async () => {
    mockFs.stat.mockRejectedValue(new Error('ENOENT'))
    const result = await parseSessionState('/fake/session.jsonl', FALLBACK_TS)
    expect(result).toBeNull()
  })

  it('returns running when last assistant has stop_reason tool_use', async () => {
    const content = toJsonl([
      {
        type: 'assistant',
        timestamp: '2026-01-01T00:00:01Z',
        message: {
          stop_reason: 'tool_use',
          content: [{ type: 'tool_use', name: 'Bash' }]
        }
      }
    ])
    setupFakeFile(content)
    const result = await parseSessionState('/fake/session.jsonl', FALLBACK_TS)
    expect(result?.state).toBe('running')
    expect(result?.currentAction).toBe('⚙ running shell command')
  })

  it('returns idle when last assistant has stop_reason end_turn', async () => {
    const content = toJsonl([
      {
        type: 'assistant',
        timestamp: '2026-01-01T00:00:01Z',
        message: {
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'Done! I refactored the auth module.' }]
        }
      }
    ])
    setupFakeFile(content)
    const result = await parseSessionState('/fake/session.jsonl', FALLBACK_TS)
    expect(result?.state).toBe('idle')
    expect(result?.currentAction).toMatch(/^✓/)
  })

  it('returns running when user message is more recent than last assistant', async () => {
    const content = toJsonl([
      {
        type: 'assistant',
        timestamp: '2026-01-01T00:00:01Z',
        message: { stop_reason: 'end_turn', content: [] }
      },
      {
        type: 'user',
        timestamp: '2026-01-01T00:00:02Z',
        message: {}
      }
    ])
    setupFakeFile(content)
    const result = await parseSessionState('/fake/session.jsonl', FALLBACK_TS)
    expect(result?.state).toBe('running')
    expect(result?.currentAction).toBe('⚙ processing…')
  })

  it('returns idle when system stop_hook_summary is most recent', async () => {
    const content = toJsonl([
      {
        type: 'assistant',
        timestamp: '2026-01-01T00:00:01Z',
        message: { stop_reason: 'tool_use', content: [] }
      },
      {
        type: 'system',
        subtype: 'stop_hook_summary',
        timestamp: '2026-01-01T00:00:02Z'
      }
    ])
    setupFakeFile(content)
    const result = await parseSessionState('/fake/session.jsonl', FALLBACK_TS)
    expect(result?.state).toBe('idle')
  })

  it('extracts lastActivity from the most recent timestamp', async () => {
    const ts = '2026-01-01T12:00:00Z'
    const content = toJsonl([
      { type: 'assistant', timestamp: ts, message: { stop_reason: 'end_turn', content: [] } }
    ])
    setupFakeFile(content)
    const result = await parseSessionState('/fake/session.jsonl', FALLBACK_TS)
    expect(result?.lastActivity).toBe(Date.parse(ts))
  })

  it('returns idle with fallback timestamp when no parseable entries', async () => {
    setupFakeFile('not json\nalso not json\n')
    const result = await parseSessionState('/fake/session.jsonl', FALLBACK_TS)
    expect(result?.state).toBe('idle')
    expect(result?.lastActivity).toBe(FALLBACK_TS)
  })
})

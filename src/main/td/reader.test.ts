import { describe, it, expect } from 'vitest'
import { parseTdJson } from './reader'

describe('parseTdJson', () => {
  it('parses valid JSON payloads', () => {
    const parsed = parseTdJson<{ ok: boolean; count: number }>('{ "ok": true, "count": 3 }', 'parse context')
    expect(parsed).toEqual({ ok: true, count: 3 })
  })

  it('throws contextual error for malformed JSON', () => {
    expect(() => parseTdJson('{ nope', 'failed to parse td output')).toThrow(/failed to parse td output:/)
  })
})

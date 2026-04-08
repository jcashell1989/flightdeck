import { describe, it, expect, beforeEach } from 'vitest'
import type { AppConfig, AgentProfile, ConfigCrypto } from './store'
import { validatePatch, toPersisted, fromPersisted } from './store'

// ── fake crypto for persistence tests ────────────────────────────────────
// A trivial reversible "encryption" (prefix + base64) so tests can verify
// round-trips without touching Electron's safeStorage.

function makeFakeCrypto(opts: { available?: boolean; encryptThrows?: boolean; decryptReturnsNull?: boolean } = {}): ConfigCrypto {
  return {
    available: () => opts.available ?? true,
    encrypt: (plain) => {
      if (opts.encryptThrows) throw new Error('fake encrypt failure')
      return 'enc:' + Buffer.from(plain, 'utf8').toString('base64')
    },
    decrypt: (cipher) => {
      if (opts.decryptReturnsNull) return null
      if (!cipher.startsWith('enc:')) return null
      try {
        return Buffer.from(cipher.slice(4), 'base64').toString('utf8')
      } catch {
        return null
      }
    }
  }
}

function baseConfig(profiles: AgentProfile[] = []): AppConfig {
  return {
    opencode: { instances: [{ host: '127.0.0.1', port: 4096 }] },
    mock: { enabled: true },
    projects: [],
    profiles
  }
}

function profile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: 'p1',
    label: 'primary',
    agentType: 'opencode',
    isDefault: true,
    apiKey: 'sk-secret',
    ...overrides
  }
}

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

// ── persistence round-trip ────────────────────────────────────────────────

describe('toPersisted / fromPersisted', () => {
  let shadow: Map<string, string>

  beforeEach(() => {
    shadow = new Map()
  })

  it('encrypts plaintext apiKey on write and strips plaintext from disk shape', () => {
    const crypto = makeFakeCrypto()
    const cfg = baseConfig([profile({ apiKey: 'sk-secret' })])

    const persisted = toPersisted(cfg, crypto, shadow)

    expect(persisted.profiles[0]).not.toHaveProperty('apiKey')
    expect(persisted.profiles[0].apiKeyEncrypted).toBe('enc:c2stc2VjcmV0')
    expect(shadow.get('p1')).toBe('enc:c2stc2VjcmV0')
  })

  it('round-trips plaintext through encrypt/decrypt', () => {
    const crypto = makeFakeCrypto()
    const cfg = baseConfig([profile({ apiKey: 'sk-secret' })])

    const persisted = toPersisted(cfg, crypto, shadow)
    const loadShadow = new Map<string, string>()
    const decoded = fromPersisted(persisted, crypto, loadShadow)

    expect(decoded.profiles[0].apiKey).toBe('sk-secret')
    expect(loadShadow.get('p1')).toBe('enc:c2stc2VjcmV0')
  })

  // ── REGRESSION: "unrelated set() wipes key" (td-ecf287 M-C1) ──

  it('preserves ciphertext when decryption fails on load and config is re-saved', () => {
    // Simulate: user saved a key on machine A, then opened config on machine B
    // where safeStorage can't decrypt. A subsequent set() (e.g. toggling mock)
    // must not wipe the ciphertext.
    const machineACrypto = makeFakeCrypto()
    const cfgA = baseConfig([profile({ apiKey: 'sk-secret' })])
    const persistedA = toPersisted(cfgA, machineACrypto, new Map())

    // Load on machine B: decryption always fails.
    const machineBCrypto = makeFakeCrypto({ decryptReturnsNull: true })
    const decoded = fromPersisted(persistedA, machineBCrypto, shadow)

    expect(decoded.profiles[0].apiKey).toBeUndefined() // decrypt failed
    expect(shadow.get('p1')).toBe(persistedA.profiles[0].apiKeyEncrypted) // cipher preserved

    // Now an unrelated patch comes in and we re-save.
    const decodedWithMockFlip: AppConfig = {
      ...decoded,
      mock: { enabled: false }
    }
    const persistedB = toPersisted(decodedWithMockFlip, machineBCrypto, shadow)

    // Critical assertion: the ciphertext on disk must still be there.
    expect(persistedB.profiles[0].apiKeyEncrypted).toBe(persistedA.profiles[0].apiKeyEncrypted)
  })

  it('preserves ciphertext when encryption is unavailable at write time', () => {
    // User loaded profiles with ciphertext on a machine with safeStorage.
    // Encryption goes unavailable (e.g. keychain locked mid-session). A later
    // set() must still preserve existing ciphertext.
    const workingCrypto = makeFakeCrypto()
    const persisted0 = toPersisted(baseConfig([profile({ apiKey: 'sk-secret' })]), workingCrypto, new Map())

    const brokenCrypto = makeFakeCrypto({ available: false })
    const decoded = fromPersisted(persisted0, brokenCrypto, shadow)
    // apiKey cannot be decrypted under broken crypto.
    expect(decoded.profiles[0].apiKey).toBeUndefined()
    expect(shadow.get('p1')).toBe(persisted0.profiles[0].apiKeyEncrypted)

    // Resave: the profile has no plaintext, so toPersisted must fall back to
    // the shadow ciphertext.
    const persisted1 = toPersisted(decoded, brokenCrypto, shadow)
    expect(persisted1.profiles[0].apiKeyEncrypted).toBe(persisted0.profiles[0].apiKeyEncrypted)
  })

  // ── REGRESSION: legacy plaintext migration (td-ecf287 M-C2) ──

  it('migrates legacy plaintext apiKey on load and encrypts on next save', () => {
    const crypto = makeFakeCrypto()
    // Simulate a pre-safeStorage persisted config with plaintext apiKey.
    const legacy = {
      opencode: { instances: [{ host: '127.0.0.1', port: 4096 }] },
      mock: { enabled: true },
      projects: [],
      profiles: [
        {
          id: 'p1',
          label: 'primary',
          agentType: 'opencode' as const,
          isDefault: true,
          apiKey: 'sk-legacy'
        }
      ]
    }

    const decoded = fromPersisted(legacy, crypto, shadow)

    // In-memory profile has the plaintext available.
    expect(decoded.profiles[0].apiKey).toBe('sk-legacy')
    // Shadow is NOT populated — we want next save to freshly encrypt.
    expect(shadow.has('p1')).toBe(false)

    // Next save encrypts it and strips plaintext from disk.
    const persisted = toPersisted(decoded, crypto, shadow)
    expect(persisted.profiles[0]).not.toHaveProperty('apiKey')
    expect(persisted.profiles[0].apiKeyEncrypted).toBe('enc:c2stbGVnYWN5')
    expect(shadow.get('p1')).toBe('enc:c2stbGVnYWN5')
  })

  it('does not wipe legacy plaintext if encryption is unavailable on load', () => {
    const crypto = makeFakeCrypto({ available: false })
    const legacy = {
      opencode: { instances: [{ host: '127.0.0.1', port: 4096 }] },
      mock: { enabled: true },
      projects: [],
      profiles: [
        {
          id: 'p1',
          label: 'primary',
          agentType: 'opencode' as const,
          isDefault: true,
          apiKey: 'sk-legacy'
        }
      ]
    }

    const decoded = fromPersisted(legacy, crypto, shadow)

    // Plaintext kept in memory so the profile is still usable.
    expect(decoded.profiles[0].apiKey).toBe('sk-legacy')
  })

  // ── Deletion / shadow pruning ──

  it('prunes shadow entries for deleted profiles on save', () => {
    const crypto = makeFakeCrypto()
    const cfg = baseConfig([
      profile({ id: 'p1', apiKey: 'sk-one' }),
      profile({ id: 'p2', label: 'secondary', isDefault: false, apiKey: 'sk-two' })
    ])
    toPersisted(cfg, crypto, shadow)
    expect(shadow.size).toBe(2)

    // Delete p2
    const next: AppConfig = { ...cfg, profiles: cfg.profiles.filter((p) => p.id !== 'p1') }
    // Actually keep p2 only — rename: we want to delete p1
    const afterDelete: AppConfig = { ...cfg, profiles: cfg.profiles.filter((p) => p.id === 'p2') }
    toPersisted(afterDelete, crypto, shadow)

    expect(shadow.has('p1')).toBe(false)
    expect(shadow.has('p2')).toBe(true)
    // Silence unused warning for `next`
    void next
  })

  // ── Encryption-available gate ──

  it('omits apiKeyEncrypted on write when no prior cipher exists and encryption is unavailable', () => {
    const crypto = makeFakeCrypto({ available: false })
    const cfg = baseConfig([profile({ apiKey: 'sk-secret' })])

    const persisted = toPersisted(cfg, crypto, shadow)
    // Cannot encrypt, no prior shadow entry → no cipher written.
    expect(persisted.profiles[0].apiKeyEncrypted).toBeUndefined()
    // But plaintext must NOT leak to disk either.
    expect(persisted.profiles[0]).not.toHaveProperty('apiKey')
  })

  it('falls back to shadow when encrypt throws at runtime', () => {
    // Prime the shadow via a working crypto first.
    const ok = makeFakeCrypto()
    const cfg = baseConfig([profile({ apiKey: 'sk-v1' })])
    toPersisted(cfg, ok, shadow)
    const v1Cipher = shadow.get('p1')

    // Now swap to a crypto that throws on encrypt. Even with a fresh plaintext,
    // we should not wipe the existing ciphertext.
    const broken: ConfigCrypto = {
      available: () => true,
      encrypt: () => {
        throw new Error('boom')
      },
      decrypt: ok.decrypt
    }
    const cfgV2: AppConfig = {
      ...cfg,
      profiles: [{ ...cfg.profiles[0], apiKey: 'sk-v2' }]
    }
    const persisted = toPersisted(cfgV2, broken, shadow)
    expect(persisted.profiles[0].apiKeyEncrypted).toBe(v1Cipher)
  })
})

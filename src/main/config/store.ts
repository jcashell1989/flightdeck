import { app, safeStorage } from 'electron'
import { promises as fs } from 'fs'
import { join, dirname } from 'path'
import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import type {
  AgentProfile,
  AppConfig,
  OpencodeInstance,
  ProjectConfig,
  ThemeId
} from '../../shared/types'

// Re-export for backward compatibility with existing import paths.
// New code should import directly from `src/shared/types`.
export type { AgentProfile, AppConfig, OpencodeInstance, ProjectConfig }

const VALID_THEME_IDS: ThemeId[] = ['os', 'dark', 'light', 'tokyo-night', 'catppuccin-mocha', 'nord']
function isValidThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && (VALID_THEME_IDS as string[]).includes(v)
}

/**
 * On-disk shape for AgentProfile — apiKey is replaced by apiKeyEncrypted.
 * A legacy plaintext `apiKey` field is tolerated on READ only (for migration
 * from pre-safeStorage configs) and never written back.
 */
interface PersistedProfile extends Omit<AgentProfile, 'apiKey'> {
  apiKeyEncrypted?: string
  /** Legacy plaintext — only present in configs written before safeStorage landed. */
  apiKey?: string
}

interface PersistedConfig {
  opencode: AppConfig['opencode']
  mock: AppConfig['mock']
  http: AppConfig['http']
  projects: AppConfig['projects']
  profiles: PersistedProfile[]
  theme: ThemeId
}

const DEFAULT_CONFIG: AppConfig = {
  opencode: { instances: [{ host: '127.0.0.1', port: 4096, label: 'local' }] },
  mock: { enabled: true },
  http: { enabled: false, bindAddress: '0.0.0.0', port: 4097, token: '' },
  projects: [],
  profiles: [],
  theme: 'dark' as ThemeId
}

// ── Crypto abstraction ─────────────────────────────────────────────────────

/**
 * Minimal interface over Electron's safeStorage — parameterised so the pure
 * serialisation helpers can be unit-tested with a fake implementation.
 */
export interface ConfigCrypto {
  available(): boolean
  /** Encrypt plaintext; returns base64 ciphertext. Caller must check available() first. */
  encrypt(plain: string): string
  /** Decrypt base64 ciphertext; returns null if decryption fails. */
  decrypt(cipher: string): string | null
}

const electronCrypto: ConfigCrypto = {
  available: () => {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  },
  encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
  decrypt: (cipher) => {
    try {
      return safeStorage.decryptString(Buffer.from(cipher, 'base64'))
    } catch {
      return null
    }
  }
}

// ── Serialisation helpers ──────────────────────────────────────────────────

/**
 * Convert in-memory AppConfig (with plaintext apiKey) to the on-disk shape.
 *
 * Key invariant: **NEVER drops a ciphertext that already exists.** If the
 * in-memory `apiKey` is absent (because decryption failed on load, or the
 * user hasn't re-entered it), we fall back to the ciphertext preserved in
 * `shadow` for that profile id. This means any unrelated `set()` that
 * round-trips the full config will not wipe the stored key.
 *
 * Also prunes shadow entries for profiles no longer present in the config,
 * so deleting a profile actually removes its ciphertext from disk.
 */
export function toPersisted(
  cfg: AppConfig,
  crypto: ConfigCrypto,
  shadow: Map<string, string>
): PersistedConfig {
  const available = crypto.available()

  const profiles: PersistedProfile[] = cfg.profiles.map((p) => {
    const { apiKey, ...rest } = p
    const persisted: PersistedProfile = { ...rest }

    let cipher: string | undefined
    if (apiKey && available) {
      // Freshly encrypt and update the shadow map.
      try {
        cipher = crypto.encrypt(apiKey)
        shadow.set(p.id, cipher)
      } catch (e) {
        console.warn(
          `[ConfigStore] encrypt failed for profile "${p.label}": ${String(e)} — ` +
            'preserving previously stored ciphertext if any.'
        )
        cipher = shadow.get(p.id)
      }
    } else {
      // Either plaintext is absent (decrypt-failed or never loaded) or
      // encryption is unavailable right now. Preserve whatever ciphertext
      // was on disk before.
      cipher = shadow.get(p.id)
    }

    if (cipher !== undefined) {
      persisted.apiKeyEncrypted = cipher
    }
    return persisted
  })

  // Prune shadow entries for deleted profiles.
  const liveIds = new Set(cfg.profiles.map((p) => p.id))
  for (const id of Array.from(shadow.keys())) {
    if (!liveIds.has(id)) shadow.delete(id)
  }

  return {
    opencode: cfg.opencode,
    mock: cfg.mock,
    http: cfg.http,
    projects: cfg.projects,
    profiles,
    theme: cfg.theme
  }
}

/**
 * Convert on-disk PersistedConfig to in-memory AppConfig.
 *
 * Populates the shadow map with every ciphertext encountered, so future writes
 * can preserve ciphertext even when decryption fails or encryption is
 * unavailable on this boot.
 *
 * Legacy migration: if a profile has a plaintext `apiKey` field (pre-safeStorage
 * configs), it is kept in memory and will be encrypted on the next `set()`.
 * The plaintext is NOT dropped until it has successfully round-tripped through
 * the shadow map as ciphertext.
 *
 * Clears the shadow map before populating to avoid carrying stale entries
 * across reloads.
 */
export function fromPersisted(
  persisted: PersistedConfig,
  crypto: ConfigCrypto,
  shadow: Map<string, string>
): AppConfig {
  const available = crypto.available()
  shadow.clear()

  const profiles: AgentProfile[] = persisted.profiles.map((p) => {
    const { apiKeyEncrypted, apiKey: legacyPlaintext, ...rest } = p
    const profile: AgentProfile = { ...rest }

    if (apiKeyEncrypted) {
      // Always preserve ciphertext in the shadow, regardless of whether we
      // can decrypt it right now. This is what prevents the "unrelated
      // set() wipes the key" bug: even if apiKey ends up undefined below,
      // the next toPersisted() will write this cipher back out.
      shadow.set(p.id, apiKeyEncrypted)

      if (available) {
        const plain = crypto.decrypt(apiKeyEncrypted)
        if (plain !== null) {
          profile.apiKey = plain
        } else {
          console.warn(
            `[ConfigStore] could not decrypt apiKey for profile "${p.label}" — ` +
              'ciphertext preserved. Re-enter the key in Settings to re-encrypt ' +
              'for this machine.'
          )
        }
      } else {
        console.warn(
          `[ConfigStore] encryption unavailable on this machine — apiKey for ` +
            `profile "${p.label}" will not be decrypted but the stored ciphertext ` +
            'is preserved.'
        )
      }
    } else if (legacyPlaintext) {
      // Pre-safeStorage migration path. Keep the plaintext in memory so the
      // profile is usable immediately; the next configStore.set() will
      // re-write with apiKeyEncrypted (provided encryption is available).
      console.warn(
        `[ConfigStore] legacy plaintext apiKey found for profile "${p.label}" — ` +
          'will be encrypted on the next save.'
      )
      profile.apiKey = legacyPlaintext
      // Deliberately do NOT populate shadow — we want the next toPersisted()
      // to run through the fresh-encrypt branch.
    }

    return profile
  })

  return {
    opencode: persisted.opencode,
    mock: persisted.mock,
    http: persisted.http ?? DEFAULT_CONFIG.http,
    projects: persisted.projects,
    theme: isValidThemeId(persisted.theme) ? persisted.theme : 'dark',
    profiles
  }
}

// ── Validation ─────────────────────────────────────────────────────────────

/**
 * Validate a config patch from the renderer before applying it.
 * Throws with a descriptive message on any shape violation.
 */
export function validatePatch(patch: unknown): Partial<AppConfig> {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    throw new Error('invalid config patch: must be a plain object')
  }
  const p = patch as Record<string, unknown>

  if ('opencode' in p) {
    const oc = p['opencode']
    if (typeof oc !== 'object' || oc === null || Array.isArray(oc)) {
      throw new Error('invalid config patch: opencode must be an object')
    }
    const ocObj = oc as Record<string, unknown>
    if (!Array.isArray(ocObj['instances'])) {
      throw new Error('invalid config patch: opencode.instances must be an array')
    }
    for (const inst of ocObj['instances'] as unknown[]) {
      if (typeof inst !== 'object' || inst === null) {
        throw new Error('invalid config patch: each opencode instance must be an object')
      }
      const i = inst as Record<string, unknown>
      if (typeof i['host'] !== 'string') {
        throw new Error('invalid config patch: opencode instance host must be a string')
      }
      if (typeof i['port'] !== 'number') {
        throw new Error('invalid config patch: opencode instance port must be a number')
      }
    }
  }

  if ('mock' in p) {
    const mock = p['mock']
    if (typeof mock !== 'object' || mock === null || Array.isArray(mock)) {
      throw new Error('invalid config patch: mock must be an object')
    }
    if (typeof (mock as Record<string, unknown>)['enabled'] !== 'boolean') {
      throw new Error('invalid config patch: mock.enabled must be a boolean')
    }
  }

  if ('projects' in p) {
    if (!Array.isArray(p['projects'])) {
      throw new Error('invalid config patch: projects must be an array')
    }
    const seenPaths = new Set<string>()
    for (const proj of p['projects'] as unknown[]) {
      if (typeof proj !== 'object' || proj === null) {
        throw new Error('invalid config patch: each project must be an object')
      }
      const pr = proj as Record<string, unknown>
      const path = pr['path']
      if (typeof path !== 'string') {
        throw new Error('invalid config patch: project path must be a string')
      }
      if (!path.startsWith('/')) {
        throw new Error(`invalid config patch: project path must be absolute: "${path}"`)
      }
      if (path.includes('\0')) {
        throw new Error('invalid config patch: project path must not contain NUL bytes')
      }
      if (seenPaths.has(path)) {
        throw new Error(`invalid config patch: duplicate project path "${path}"`)
      }
      seenPaths.add(path)
      if (typeof pr['archived'] !== 'boolean') {
        throw new Error('invalid config patch: project archived must be a boolean')
      }
    }
  }

  if ('http' in p) {
    const h = p['http']
    if (typeof h !== 'object' || h === null) throw new Error('invalid config patch: http must be an object')
    const hObj = h as Record<string, unknown>
    if ('enabled' in hObj && typeof hObj['enabled'] !== 'boolean') throw new Error('invalid config patch: http.enabled must be a boolean')
    if ('port' in hObj && typeof hObj['port'] !== 'number') throw new Error('invalid config patch: http.port must be a number')
    if ('bindAddress' in hObj && typeof hObj['bindAddress'] !== 'string') throw new Error('invalid config patch: http.bindAddress must be a string')
    if ('token' in hObj && typeof hObj['token'] !== 'string') throw new Error('invalid config patch: http.token must be a string')
  }

  if ('theme' in p) {
    if (!isValidThemeId(p['theme'])) {
      throw new Error('invalid config patch: theme must be one of: ' + VALID_THEME_IDS.join(', '))
    }
  }

  if ('profiles' in p) {
    if (!Array.isArray(p['profiles'])) {
      throw new Error('invalid config patch: profiles must be an array')
    }
    const seenIds = new Set<string>()
    for (const prof of p['profiles'] as unknown[]) {
      if (typeof prof !== 'object' || prof === null) {
        throw new Error('invalid config patch: each profile must be an object')
      }
      const pr = prof as Record<string, unknown>
      const id = pr['id']
      if (typeof id !== 'string' || id.length === 0) {
        throw new Error('invalid config patch: profile id must be a non-empty string')
      }
      if (seenIds.has(id)) {
        throw new Error(`invalid config patch: duplicate profile id "${id}"`)
      }
      seenIds.add(id)
      if (typeof pr['label'] !== 'string') {
        throw new Error('invalid config patch: profile label must be a string')
      }
      if (pr['agentType'] !== 'opencode' && pr['agentType'] !== 'claude-code') {
        throw new Error('invalid config patch: profile agentType must be opencode or claude-code')
      }
      if (typeof pr['isDefault'] !== 'boolean') {
        throw new Error('invalid config patch: profile isDefault must be a boolean')
      }
      // Optional string fields
      for (const field of ['provider', 'model', 'apiKey'] as const) {
        if (field in pr && pr[field] !== undefined && typeof pr[field] !== 'string') {
          throw new Error(`invalid config patch: profile ${field} must be a string`)
        }
      }
      if ('permissionMode' in pr && pr['permissionMode'] !== undefined) {
        if (pr['permissionMode'] !== 'default' && pr['permissionMode'] !== 'acceptEdits') {
          throw new Error('invalid config patch: profile permissionMode must be default or acceptEdits')
        }
      }
    }
  }

  return p as Partial<AppConfig>
}

// ── ConfigStore ────────────────────────────────────────────────────────────

class ConfigStore extends EventEmitter {
  private config: AppConfig = DEFAULT_CONFIG
  private path: string = ''
  private loaded = false

  constructor() {
    super()
    // Test hot-reload can register many ephemeral listeners; raise the cap
    // so we don't trip MaxListenersExceededWarning in noisy suites.
    this.setMaxListeners(50)
  }
  /**
   * profileId → base64 safeStorage ciphertext, populated on load and on every
   * successful encrypt. Reserved as the fallback source of ciphertext when
   * writing a profile whose in-memory `apiKey` is absent, so unrelated
   * `set()` calls can never wipe a stored key.
   */
  private shadowEncrypted = new Map<string, string>()

  async init(): Promise<AppConfig> {
    this.path = join(app.getPath('userData'), 'config.json')

    let raw: string
    try {
      raw = await fs.readFile(this.path, 'utf8')
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code
      if (code === 'ENOENT') {
        // First run: create defaults with a generated token.
        const firstRunConfig: AppConfig = {
          ...DEFAULT_CONFIG,
          http: { ...DEFAULT_CONFIG.http, token: randomUUID() }
        }
        await this.writePersisted(toPersisted(firstRunConfig, electronCrypto, this.shadowEncrypted))
        this.config = firstRunConfig
        this.loaded = true
        return this.config
      }
      // Any other read error (EACCES, EBUSY, …) — preserve the file on disk
      // and fall back to in-memory defaults. DO NOT write.
      console.error(
        `[ConfigStore] failed to read ${this.path} (${code ?? 'unknown'}): ${String(e)}. ` +
          'Using in-memory defaults; NOT writing to disk to avoid data loss.'
      )
      this.config = DEFAULT_CONFIG
      this.loaded = true
      return this.config
    }

    let parsed: PersistedConfig
    try {
      parsed = JSON.parse(raw) as PersistedConfig
    } catch (e) {
      // Corrupt JSON on disk. Back up the bad file before overwriting.
      const bakPath = this.path + '.bak'
      try {
        await fs.writeFile(bakPath, raw, 'utf8')
        console.warn(
          `[ConfigStore] config.json failed to parse (${String(e)}); ` +
            `backed up to ${bakPath}. Writing defaults.`
        )
      } catch (bakErr) {
        console.error(
          `[ConfigStore] additionally failed to write backup ${bakPath}: ${String(bakErr)}. ` +
            'Defaults will be written anyway.'
        )
      }
      await this.writePersisted(toPersisted(DEFAULT_CONFIG, electronCrypto, this.shadowEncrypted))
      this.config = DEFAULT_CONFIG
      this.loaded = true
      return this.config
    }

    const decoded = fromPersisted(parsed, electronCrypto, this.shadowEncrypted)
    this.config = this.merge(DEFAULT_CONFIG, decoded)
    this.loaded = true
    if (!this.config.http.token) {
      this.config.http.token = randomUUID()
      await this.writePersisted(toPersisted(this.config, electronCrypto, this.shadowEncrypted))
    }
    return this.config
  }

  get(): AppConfig {
    if (!this.loaded) throw new Error('ConfigStore not initialized')
    return this.config
  }

  async set(patch: unknown): Promise<AppConfig> {
    const validated = validatePatch(patch)
    const next = this.merge(this.config, validated)
    await this.writePersisted(toPersisted(next, electronCrypto, this.shadowEncrypted))
    this.config = next
    this.emit('change', next)
    return next
  }

  private merge(base: AppConfig, patch: Partial<AppConfig>): AppConfig {
    // Shallow merge at the top level: callers must provide a complete object
    // for any section they patch (e.g. `{ mock: { enabled: false } }` replaces
    // the whole `mock` object). Acceptable today because each section is
    // small; revisit if any section grows independently mutable fields.
    return {
      opencode: patch.opencode ?? base.opencode,
      mock: patch.mock ?? base.mock,
      http: patch.http ?? base.http,
      projects: patch.projects ?? base.projects,
      profiles: patch.profiles ?? base.profiles,
      theme: patch.theme ?? base.theme
    }
  }

  private async writePersisted(cfg: PersistedConfig): Promise<void> {
    await fs.mkdir(dirname(this.path), { recursive: true })
    const tmp = this.path + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(cfg, null, 2), 'utf8')
    await fs.rename(tmp, this.path)
    if (process.platform !== 'win32') {
      try { await fs.chmod(this.path, 0o600) } catch { /* non-fatal */ }
    }
  }
}

export const configStore = new ConfigStore()

import { app, safeStorage } from 'electron'
import { promises as fs } from 'fs'
import { join, dirname } from 'path'
import { EventEmitter } from 'events'

export interface OpencodeInstance {
  host: string
  port: number
  label?: string
}

export interface AgentProfile {
  /** Stable UUID — never changes after creation */
  id: string
  /** Human-readable name shown in Settings and the dispatch overlay */
  label: string
  /** Agent type. Only 'opencode' profiles are dispatchable. */
  agentType: 'opencode' | 'claude-code'
  /** Provider identifier passed as OPENCODE_PROVIDER env var (e.g. 'openrouter', 'anthropic') */
  provider?: string
  /** Model identifier passed as OPENCODE_MODEL env var (e.g. 'openrouter/kimi-k2.5') */
  model?: string
  /**
   * Decrypted API key — present in memory only, never written to disk.
   * On disk the key is stored as `apiKeyEncrypted` (base64 safeStorage ciphertext).
   */
  apiKey?: string
  /** When true, this profile is pre-selected in the dispatch overlay */
  isDefault: boolean
}

export interface ProjectConfig {
  /** Absolute path to the project directory */
  path: string
  /** Optional display name override (defaults to last path segment) */
  name?: string
  /** Soft-deleted projects are hidden from the dashboard but preserved */
  archived: boolean
}

export interface AppConfig {
  opencode: { instances: OpencodeInstance[] }
  mock: { enabled: boolean }
  projects: ProjectConfig[]
  profiles: AgentProfile[]
}

/**
 * On-disk shape for AgentProfile — apiKey is replaced by apiKeyEncrypted.
 * We keep apiKey absent from disk entirely.
 */
interface PersistedProfile extends Omit<AgentProfile, 'apiKey'> {
  apiKeyEncrypted?: string
}

interface PersistedConfig {
  opencode: AppConfig['opencode']
  mock: AppConfig['mock']
  projects: AppConfig['projects']
  profiles: PersistedProfile[]
}

const DEFAULT_CONFIG: AppConfig = {
  opencode: { instances: [{ host: '127.0.0.1', port: 4096, label: 'local' }] },
  mock: { enabled: true },
  projects: [],
  profiles: []
}

// ── safeStorage helpers ────────────────────────────────────────────────────

/**
 * Encrypt a plaintext API key. Returns a base64 string safe for JSON storage.
 * Must only be called after app.whenReady().
 */
function encryptKey(plain: string): string {
  const buf = safeStorage.encryptString(plain)
  return buf.toString('base64')
}

/**
 * Decrypt a base64-encoded ciphertext produced by encryptKey.
 * Returns null if decryption fails (e.g. key was produced on a different machine).
 */
function decryptKey(cipher: string): string | null {
  try {
    const buf = Buffer.from(cipher, 'base64')
    return safeStorage.decryptString(buf)
  } catch {
    return null
  }
}

// ── Serialisation helpers ──────────────────────────────────────────────────

/**
 * Convert in-memory AppConfig (with plaintext apiKey) to the on-disk shape
 * (with apiKeyEncrypted, no apiKey).
 */
function toPersistedConfig(cfg: AppConfig): PersistedConfig {
  return {
    ...cfg,
    profiles: cfg.profiles.map((p) => {
      const { apiKey, ...rest } = p
      const persisted: PersistedProfile = { ...rest }
      if (apiKey) {
        persisted.apiKeyEncrypted = encryptKey(apiKey)
      }
      return persisted
    })
  }
}

/**
 * Convert on-disk PersistedConfig to in-memory AppConfig (decrypt keys).
 * If a key cannot be decrypted (wrong machine / corrupted), apiKey is omitted
 * and a warning is logged — the profile is still usable, just keyless.
 */
function fromPersistedConfig(persisted: PersistedConfig): AppConfig {
  return {
    ...persisted,
    profiles: persisted.profiles.map((p) => {
      const { apiKeyEncrypted, ...rest } = p
      const profile: AgentProfile = { ...rest }
      if (apiKeyEncrypted) {
        const plain = decryptKey(apiKeyEncrypted)
        if (plain !== null) {
          profile.apiKey = plain
        } else {
          console.warn(
            `[ConfigStore] could not decrypt apiKey for profile "${p.label}" — ` +
              'key may have been encrypted on a different machine. Re-enter the key in Settings.'
          )
        }
      }
      return profile
    })
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
    for (const proj of p['projects'] as unknown[]) {
      if (typeof proj !== 'object' || proj === null) {
        throw new Error('invalid config patch: each project must be an object')
      }
      const pr = proj as Record<string, unknown>
      if (typeof pr['path'] !== 'string') {
        throw new Error('invalid config patch: project path must be a string')
      }
      if (typeof pr['archived'] !== 'boolean') {
        throw new Error('invalid config patch: project archived must be a boolean')
      }
    }
  }

  if ('profiles' in p) {
    if (!Array.isArray(p['profiles'])) {
      throw new Error('invalid config patch: profiles must be an array')
    }
    for (const prof of p['profiles'] as unknown[]) {
      if (typeof prof !== 'object' || prof === null) {
        throw new Error('invalid config patch: each profile must be an object')
      }
      const pr = prof as Record<string, unknown>
      if (typeof pr['id'] !== 'string') {
        throw new Error('invalid config patch: profile id must be a string')
      }
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
    }
  }

  return p as Partial<AppConfig>
}

// ── ConfigStore ────────────────────────────────────────────────────────────

class ConfigStore extends EventEmitter {
  private config: AppConfig = DEFAULT_CONFIG
  private path: string = ''
  private loaded = false

  async init(): Promise<AppConfig> {
    this.path = join(app.getPath('userData'), 'config.json')
    try {
      const raw = await fs.readFile(this.path, 'utf8')
      const parsed = JSON.parse(raw) as PersistedConfig
      // Migrate: if any profile still has a plaintext apiKey on disk (legacy),
      // fromPersistedConfig won't find apiKeyEncrypted and apiKey stays absent.
      // The user will need to re-enter it — acceptable one-time migration cost.
      const decoded = fromPersistedConfig(parsed)
      this.config = this.merge(DEFAULT_CONFIG, decoded)
    } catch {
      await this.writePersisted(toPersistedConfig(DEFAULT_CONFIG))
      this.config = DEFAULT_CONFIG
    }
    this.loaded = true
    return this.config
  }

  get(): AppConfig {
    if (!this.loaded) throw new Error('ConfigStore not initialized')
    return this.config
  }

  async set(patch: unknown): Promise<AppConfig> {
    const validated = validatePatch(patch)
    const next = this.merge(this.config, validated)
    await this.writePersisted(toPersistedConfig(next))
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
      projects: patch.projects ?? base.projects,
      profiles: patch.profiles ?? base.profiles
    }
  }

  private async writePersisted(cfg: PersistedConfig): Promise<void> {
    await fs.mkdir(dirname(this.path), { recursive: true })
    const tmp = this.path + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(cfg, null, 2), 'utf8')
    await fs.rename(tmp, this.path)
  }
}

export const configStore = new ConfigStore()

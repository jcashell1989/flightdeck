import { app } from 'electron'
import { promises as fs } from 'fs'
import { join, dirname } from 'path'
import { EventEmitter } from 'events'

export interface OpencodeInstance {
  host: string
  port: number
  label?: string
}

export interface AppConfig {
  opencode: { instances: OpencodeInstance[] }
  mock: { enabled: boolean }
}

const DEFAULT_CONFIG: AppConfig = {
  opencode: { instances: [{ host: '127.0.0.1', port: 4096, label: 'local' }] },
  mock: { enabled: true }
}

class ConfigStore extends EventEmitter {
  private config: AppConfig = DEFAULT_CONFIG
  private path: string = ''
  private loaded = false

  async init(): Promise<AppConfig> {
    this.path = join(app.getPath('userData'), 'config.json')
    try {
      const raw = await fs.readFile(this.path, 'utf8')
      const parsed = JSON.parse(raw)
      this.config = this.merge(DEFAULT_CONFIG, parsed)
    } catch {
      await this.write(DEFAULT_CONFIG)
      this.config = DEFAULT_CONFIG
    }
    this.loaded = true
    return this.config
  }

  get(): AppConfig {
    if (!this.loaded) throw new Error('ConfigStore not initialized')
    return this.config
  }

  async set(patch: Partial<AppConfig>): Promise<AppConfig> {
    const next = this.merge(this.config, patch)
    await this.write(next)
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
      mock: patch.mock ?? base.mock
    }
  }

  private async write(cfg: AppConfig): Promise<void> {
    await fs.mkdir(dirname(this.path), { recursive: true })
    const tmp = this.path + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(cfg, null, 2), 'utf8')
    await fs.rename(tmp, this.path)
  }
}

export const configStore = new ConfigStore()

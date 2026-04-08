/**
 * OpencodeLauncher — spawns and manages `opencode serve` processes on behalf
 * of AgentProfiles.
 *
 * Each managed instance is keyed by `${profileId}:${directory}`. When a
 * dispatch request arrives for a (profile, directory) pair that has no running
 * instance, the launcher:
 *   1. Finds a free port in PORT_RANGE
 *   2. Spawns `opencode serve --port <port>` with the profile's env vars
 *   3. Polls the server until it responds (max STARTUP_TIMEOUT_MS)
 *   4. Returns the port so the registry can connect a client
 *
 * Instances stay alive until stopAll() is called (app quit) or stop() is
 * called explicitly. The process manager never writes to opencode config files.
 */
import { EventEmitter } from 'events'
import { spawn, ChildProcess } from 'child_process'
import * as net from 'net'
import type { AgentProfile } from '../config/store'

const PORT_RANGE_START = 4100
const PORT_RANGE_END = 4200
const STARTUP_TIMEOUT_MS = 10_000
const STARTUP_POLL_MS = 500

interface ManagedEntry {
  process: ChildProcess
  port: number
  profileId: string
  directory: string
}

function instanceKey(profileId: string, directory: string): string {
  return `${profileId}:${directory}`
}

/** Check if a TCP port is free by attempting to bind to it briefly. */
function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, '127.0.0.1')
  })
}

/** Poll http://127.0.0.1:<port>/ until it responds or timeout elapses. */
async function waitForServer(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const alive = await new Promise<boolean>((resolve) => {
      const req = net.createConnection({ host: '127.0.0.1', port })
      req.once('connect', () => {
        req.destroy()
        resolve(true)
      })
      req.once('error', () => resolve(false))
    })
    if (alive) return
    await new Promise((r) => setTimeout(r, STARTUP_POLL_MS))
  }
  throw new Error(`opencode serve on port ${port} did not start within ${timeoutMs}ms`)
}

/** Build the env vars to pass to opencode serve for a given profile. */
function buildEnv(profile: AgentProfile): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }

  if (profile.model) env['OPENCODE_MODEL'] = profile.model
  if (profile.provider) env['OPENCODE_PROVIDER'] = profile.provider

  if (profile.apiKey) {
    // Map provider to the expected env var name.
    const provider = (profile.provider ?? '').toLowerCase()
    if (provider === 'openrouter') {
      env['OPENROUTER_API_KEY'] = profile.apiKey
    } else if (provider === 'anthropic') {
      env['ANTHROPIC_API_KEY'] = profile.apiKey
    } else if (provider === 'openai') {
      env['OPENAI_API_KEY'] = profile.apiKey
    } else if (provider === 'google') {
      env['GOOGLE_API_KEY'] = profile.apiKey
    } else {
      // Unknown provider — log a warning and do not set any key env var.
      // Silently setting OPENROUTER_API_KEY for an unrecognised provider would
      // pass the wrong key to the server and produce confusing auth errors.
      console.warn(
        `[launcher] unknown provider "${provider}" for profile "${profile.label}" — ` +
          'no API key env var set. Add a provider mapping in launcher.ts if needed.'
      )
    }
  }

  return env
}

export class OpencodeLauncher extends EventEmitter {
  private instances = new Map<string, ManagedEntry>()
  private disposed = false

  /**
   * Ensure an opencode serve instance is running for the given profile and
   * directory. Returns the port it's listening on.
   *
   * If an instance is already running for this (profileId, directory) pair,
   * returns its port immediately without spawning a new process.
   */
  async launch(profile: AgentProfile, directory: string): Promise<number> {
    if (this.disposed) throw new Error('OpencodeLauncher is disposed')

    const key = instanceKey(profile.id, directory)
    const existing = this.instances.get(key)
    if (existing && existing.process.exitCode === null) {
      return existing.port
    }

    const port = await this.findFreePort()
    const env = buildEnv(profile)

    const child = spawn('opencode', ['serve', '--port', String(port)], {
      cwd: directory,
      env,
      stdio: 'pipe',
      detached: false
    })

    const entry: ManagedEntry = {
      process: child,
      port,
      profileId: profile.id,
      directory
    }
    this.instances.set(key, entry)

    child.on('exit', (code) => {
      this.instances.delete(key)
      this.emit('stopped', { profileId: profile.id, directory, port, code })
    })

    child.on('error', (err) => {
      this.instances.delete(key)
      this.emit('error', { profileId: profile.id, directory, port, error: err })
    })

    try {
      await waitForServer(port, STARTUP_TIMEOUT_MS)
    } catch (err) {
      // Server didn't start — kill the process and clean up.
      child.kill('SIGTERM')
      this.instances.delete(key)
      throw err
    }

    this.emit('started', { profileId: profile.id, directory, port })
    return port
  }

  /** Stop a specific managed instance. No-op if not running. */
  stop(profileId: string, directory: string): void {
    const key = instanceKey(profileId, directory)
    const entry = this.instances.get(key)
    if (!entry) return
    entry.process.kill('SIGTERM')
    this.instances.delete(key)
  }

  /** Stop all managed instances. Called on app quit. */
  stopAll(): void {
    this.disposed = true
    for (const entry of this.instances.values()) {
      entry.process.kill('SIGTERM')
    }
    this.instances.clear()
    this.removeAllListeners()
  }

  /** Return the port for a running instance, or null if not running. */
  getPort(profileId: string, directory: string): number | null {
    const entry = this.instances.get(instanceKey(profileId, directory))
    if (!entry || entry.process.exitCode !== null) return null
    return entry.port
  }

  private async findFreePort(): Promise<number> {
    for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
      if (await isPortFree(port)) return port
    }
    throw new Error(
      `No free port found in range ${PORT_RANGE_START}–${PORT_RANGE_END}`
    )
  }
}

export const opencodeLauncher = new OpencodeLauncher()

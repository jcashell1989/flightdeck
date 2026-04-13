/**
 * ClaudeLauncher — spawns and manages `claude -p` subprocess sessions on
 * behalf of AgentProfiles.
 *
 * Unlike OpencodeLauncher, there is no HTTP server or port management here.
 * Each dispatch maps to a single `claude` child process. Session identity is
 * extracted from the first `{"type":"system","subtype":"init","session_id":"…"}`
 * JSON line emitted on stdout. Auth is handled by the Claude CLI itself via
 * OAuth / keychain — no env var injection is needed.
 */
import { EventEmitter } from 'events'
import { spawn, ChildProcess, execFile } from 'child_process'
import type { AgentProfile } from '../config/store'

const STARTUP_TIMEOUT_MS = 10_000
/** How long to give a child to exit gracefully after SIGTERM before SIGKILL. */
const KILL_GRACE_MS = 2_000

/**
 * Send SIGTERM to a child, follow up with SIGKILL after a grace period if
 * the child hasn't exited. Resolves once the child has actually exited (or
 * was already gone). Never rejects.
 */
function killChild(child: ChildProcess, graceMs = KILL_GRACE_MS): Promise<void> {
  if (child.exitCode !== null || child.killed) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve()
    }
    child.once('exit', finish)
    try {
      child.kill('SIGTERM')
    } catch {
      // Process may have died between the exitCode check and kill().
      finish()
      return
    }
    const timer = setTimeout(() => {
      if (child.exitCode === null && !child.killed) {
        try {
          child.kill('SIGKILL')
        } catch {
          // ignore — 'exit' will still fire or already has
        }
      }
    }, graceMs)
  })
}

export interface ClaudeLaunchResult {
  sessionId: string
  pid: number
}

interface ManagedEntry {
  process: ChildProcess
  sessionId: string
  profileId: string
  directory: string
}

function instanceKey(profileId: string, directory: string, sessionId?: string): string {
  return sessionId ? `${profileId}:${directory}:${sessionId}` : `${profileId}:${directory}`
}

export interface Launcher {
  stop(profileId: string, directory: string): void
  stopAllAsync(graceMs?: number): Promise<void>
  dispose(): void
  // EventEmitter events: 'started' | 'stopped' | 'error'
}

export class ClaudeLauncher extends EventEmitter implements Launcher {
  private instances = new Map<string, ManagedEntry>()
  private disposed = false
  private claudePath = ''

  private constructor() {
    super()
  }

  /**
   * Resolve the `claude` binary via `which claude`, cache the path, and
   * return a ready-to-use ClaudeLauncher instance.
   *
   * Throws a clear error if the binary is not on PATH so the caller can
   * surface a useful message rather than a confusing spawn failure.
   */
  static async create(): Promise<ClaudeLauncher> {
    const instance = new ClaudeLauncher()
    instance.claudePath = await instance.resolveClaudePath()
    return instance
  }

  /**
   * Spawn `claude -p <prompt>` for the given profile and directory. Reads
   * stdout line-by-line waiting for the init JSON line to extract the
   * session_id. Rejects if no init line appears within STARTUP_TIMEOUT_MS.
   */
  async launch(
    profile: AgentProfile,
    directory: string,
    prompt: string
  ): Promise<ClaudeLaunchResult> {
    if (this.disposed) throw new Error('ClaudeLauncher is disposed')

    const args = this.buildArgs(prompt, profile)
    return this.spawnAndWait(args, profile, directory)
  }

  /**
   * Resume an existing claude session by session ID. Same as launch but
   * prepends `--resume <sessionId>` to the args.
   */
  async resume(
    sessionId: string,
    profile: AgentProfile,
    directory: string,
    prompt: string
  ): Promise<ClaudeLaunchResult> {
    if (this.disposed) throw new Error('ClaudeLauncher is disposed')

    // Guard: reject if a process is already managing this sessionId
    for (const entry of this.instances.values()) {
      if (entry.sessionId === sessionId) {
        throw new Error(`session ${sessionId} is already running — stop it before resuming`)
      }
    }

    const args = ['--resume', sessionId, ...this.buildArgs(prompt, profile)]
    return this.spawnAndWait(args, profile, directory)
  }

  /**
   * Stop a specific managed instance (fire-and-forget). Sends SIGTERM to the
   * matching instance if it is still running. The 'exit' handler removes the
   * map entry once the process has actually terminated.
   */
  stop(profileId: string, directory: string): void {
    for (const [, entry] of this.instances) {
      if (entry.profileId === profileId && entry.directory === directory) {
        try {
          entry.process.kill('SIGTERM')
        } catch {
          // Process may already be gone.
        }
      }
    }
  }

  /**
   * Stop all managed instances and wait for them to exit. Sends SIGTERM,
   * waits up to `graceMs`, then SIGKILLs any survivors. Resolves once every
   * child process has actually exited.
   */
  async stopAllAsync(graceMs = KILL_GRACE_MS): Promise<void> {
    this.disposed = true
    const pending = Array.from(this.instances.values()).map((entry) =>
      killChild(entry.process, graceMs)
    )
    await Promise.all(pending)
    // At this point every 'exit' handler has fired and removed its entry,
    // but clear defensively in case of a mocked/partial test environment.
    this.instances.clear()
    this.removeAllListeners()
  }

  /** Mark as disposed, kill all tracked instances, and remove all listeners. */
  dispose(): void {
    this.disposed = true
    for (const entry of this.instances.values()) {
      void killChild(entry.process)
    }
    this.instances.clear()
    this.removeAllListeners()
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /** Build the base args array for a `claude -p` invocation. */
  private buildArgs(prompt: string, profile: AgentProfile): string[] {
    const args = [
      '-p',
      prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'acceptEdits'
    ]
    if (profile.model) {
      args.push('--model', profile.model)
    }
    return args
  }

  /**
   * Spawn the claude binary with the given args, wait for the init line, and
   * register the process in the instances map.
   */
  private spawnAndWait(
    args: string[],
    profile: AgentProfile,
    directory: string
  ): Promise<ClaudeLaunchResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.claudePath, args, {
        cwd: directory,
        env: this.buildEnv(),
        stdio: 'pipe',
        detached: false
      })

      // Drain stderr to surface errors in the main-process console.
      child.stderr?.on('data', (buf: Buffer) => {
        const line = buf.toString().trimEnd()
        if (line) console.error(`[claude:${profile.label}] ${line}`)
      })
      child.stderr?.resume()

      let settled = false
      let sessionId: string | undefined

      const fail = (err: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        child.stdout?.removeAllListeners('data')
        void killChild(child)
        reject(err)
      }

      // Startup timeout — reject if no init line arrives in time.
      const timer = setTimeout(() => {
        fail(
          new Error(
            `claude did not emit session init within ${STARTUP_TIMEOUT_MS}ms ` +
              `(profile: "${profile.label}", dir: "${directory}")`
          )
        )
      }, STARTUP_TIMEOUT_MS)

      // Handle early exit before init.
      child.once('exit', (code) => {
        if (!settled) {
          fail(
            new Error(
              `claude exited before emitting session init (code ${code ?? 'null'}) ` +
                `(profile: "${profile.label}", dir: "${directory}")`
            )
          )
        }
      })

      // Read stdout line-by-line looking for the init JSON.
      let buffer = ''
      child.stdout?.on('data', (chunk: Buffer) => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue

          if (!sessionId) {
            try {
              const parsed = JSON.parse(trimmed) as Record<string, unknown>
              if (parsed['type'] === 'system' && parsed['subtype'] === 'init') {
                sessionId = parsed['session_id'] as string
              }
            } catch {
              // Not JSON — skip.
            }
          }

          if (sessionId && !settled) {
            settled = true
            clearTimeout(timer)

            const pid = child.pid
            if (pid === undefined) {
              fail(new Error('child process has no pid — spawn may have failed silently'))
              return
            }
            const key = instanceKey(profile.id, directory, sessionId)
            const entry: ManagedEntry = {
              process: child,
              sessionId,
              profileId: profile.id,
              directory
            }
            this.instances.set(key, entry)

            child.on('exit', (code) => {
              this.instances.delete(key)
              this.emit('stopped', { profileId: profile.id, directory, sessionId, code })
            })

            child.on('error', (err) => {
              this.instances.delete(key)
              this.emit('error', { profileId: profile.id, directory, sessionId, error: err })
            })

            this.emit('started', { sessionId, directory, profileId: profile.id, pid })
            resolve({ sessionId, pid })
            child.stdout?.removeAllListeners('data')
            buffer = ''
          }
        }
      })
    })
  }

  /**
   * Claude CLI uses its own OAuth/keychain auth. No env var injection needed.
   */
  private buildEnv(): NodeJS.ProcessEnv {
    return { ...process.env }
  }

  /** Resolve the `claude` binary path via `which`. */
  private resolveClaudePath(): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('which', ['claude'], (err, stdout) => {
        if (err || !stdout.trim()) {
          reject(new Error('claude binary not found on PATH — install Claude Code CLI'))
          return
        }
        resolve(stdout.trim())
      })
    })
  }
}

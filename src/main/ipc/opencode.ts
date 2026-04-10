import { execFile } from 'child_process'
import { opencodeRegistry } from '../opencode/registry'
import { safeHandle } from './_helpers'

function runCmd(
  cmd: string,
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({
          stdout: stdout?.toString() ?? '',
          stderr: stderr?.toString() ?? '',
          code: err ? (err as NodeJS.ErrnoException & { code?: number }).code ?? 1 : 0
        })
      }
    )
  })
}

/**
 * Reject paths that are empty, non-absolute, contain NULs, or start with a
 * dash — execFile avoids shell injection, but both git and td will interpret
 * a leading-dash path as an option flag.
 */
function validPath(p: string): boolean {
  return typeof p === 'string' && p.length > 0 && p.startsWith('/') && !p.includes('\0')
}

export function register(broadcast: (channel: string, payload: unknown) => void): void {
  safeHandle('opencode:snapshot', () => opencodeRegistry.snapshot())

  safeHandle('opencode:session:messages', async (_e, sessionId: string) => {
    const client = opencodeRegistry.findClientForSession(sessionId)
    // Unknown sessions return an empty transcript rather than throwing.
    // A stale sessionId rehydrated from persisted UI state (or a claude-code
    // session id that slipped past the renderer's monitor-only guard) would
    // otherwise spam the main log with handler errors on every refetch.
    // Write-path handlers (prompt/respond/abort) still throw, because those
    // imply a user action that should surface the failure.
    if (!client) return []
    return client.fetchMessages(sessionId)
  })

  safeHandle(
    'opencode:session:prompt',
    async (_e, sessionId: string, text: string) => {
      const client = opencodeRegistry.findClientForSession(sessionId)
      if (!client) throw new Error(`no client owns session ${sessionId}`)
      await client.sendPrompt(sessionId, text)
      return { ok: true }
    }
  )

  safeHandle(
    'opencode:session:respond',
    async (
      _e,
      sessionId: string,
      permissionId: string,
      response: 'once' | 'always' | 'reject'
    ) => {
      const client = opencodeRegistry.findClientForSession(sessionId)
      if (!client) throw new Error(`no client owns session ${sessionId}`)
      await client.respondPermission(sessionId, permissionId, response)
      return { ok: true }
    }
  )

  safeHandle('opencode:session:command', async (_e, sessionId: string, command: string, args: string) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(command)) throw new Error(`invalid command name: ${command}`)
    const client = opencodeRegistry.findClientForSession(sessionId)
    if (!client) throw new Error(`no client owns session ${sessionId}`)
    return client.postCommand(sessionId, command, args)
  })

  safeHandle('opencode:commands:list', async (_e, sessionId: string) => {
    const client = opencodeRegistry.findClientForSession(sessionId)
    if (!client) return []
    return client.listCommands()
  })

  safeHandle('opencode:session:abort', async (_e, sessionId: string) => {
    const client = opencodeRegistry.findClientForSession(sessionId)
    if (!client) throw new Error(`no client owns session ${sessionId}`)
    await client.abortSession(sessionId)
    return { ok: true }
  })

  safeHandle(
    'opencode:session:create',
    async (
      _e,
      args: { instanceKey?: string; directory: string; prompt: string; title?: string }
    ) => {
      const maybeClient = args.instanceKey
        ? opencodeRegistry.findClientByKey(args.instanceKey)
        : opencodeRegistry.firstClient()
      if (!maybeClient) throw new Error('no opencode client available')
      const client = maybeClient

      // Wait for the client to reach 'connected' before creating a session —
      // otherwise createSession can race the hydrate window and the resulting
      // session id may not show up in the next SSE snapshot immediately, or
      // the HTTP request can fail against a still-initialising server.
      // Uses .on (not .once) so intermediate 'reconnecting'/'connecting'
      // events don't consume the listener before 'connected' arrives.
      if (client.snapshot().status !== 'connected') {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            client.off('status', onStatus)
            reject(new Error('opencode client connect timeout'))
          }, 8000)
          function onStatus(ev: { status: string }): void {
            if (ev.status === 'connected') {
              clearTimeout(timeout)
              client.off('status', onStatus)
              resolve()
            } else if (ev.status === 'error') {
              clearTimeout(timeout)
              client.off('status', onStatus)
              reject(new Error('opencode client error'))
            }
          }
          client.on('status', onStatus)
        })
      }

      const id = await client.createSession(args.directory, args.title)
      await client.sendPrompt(id, args.prompt)
      return { sessionId: id }
    }
  )

  safeHandle('opencode:diff', async (_e, path: string) => {
    if (!validPath(path)) throw new Error('invalid path')
    return runCmd('git', ['-C', path, 'diff', '--no-color'], path)
  })

  safeHandle('opencode:todo', async (_e, path: string) => {
    if (!validPath(path)) throw new Error('invalid path')
    return runCmd('td', ['usage', '-q', '-w', path], path)
  })

  // HMR safety: clear any prior listener before attaching a fresh one.
  opencodeRegistry.removeAllListeners('change')
  opencodeRegistry.on('change', () => {
    broadcast('opencode:snapshot', opencodeRegistry.snapshot())
  })
}

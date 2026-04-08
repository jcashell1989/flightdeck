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
    if (!client) throw new Error(`no client owns session ${sessionId}`)
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
      const client = args.instanceKey
        ? opencodeRegistry.findClientByKey(args.instanceKey)
        : opencodeRegistry.firstClient()
      if (!client) throw new Error('no opencode client available')
      const id = await client.createSession(args.directory, args.title)
      await client.sendPrompt(id, args.prompt)
      return { sessionId: id }
    }
  )

  safeHandle('opencode:diff', async (_e, path: string) => {
    if (!validPath(path)) return { stdout: '', stderr: 'invalid path', code: 1 }
    return runCmd('git', ['-C', path, 'diff', '--no-color'], path)
  })

  safeHandle('opencode:todo', async (_e, path: string) => {
    if (!validPath(path)) return { stdout: '', stderr: 'invalid path', code: 1 }
    return runCmd('td', ['usage', '-q', '-w', path], path)
  })

  // HMR safety: clear any prior listener before attaching a fresh one.
  opencodeRegistry.removeAllListeners('change')
  opencodeRegistry.on('change', () => {
    broadcast('opencode:snapshot', opencodeRegistry.snapshot())
  })
}

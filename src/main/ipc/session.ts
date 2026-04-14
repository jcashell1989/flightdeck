/**
 * IPC handlers for agent session operations.
 *
 * Renamed channels (Phase 7):
 *   opencode:snapshot          → agent:snapshot
 *   opencode:session:messages  → agent:messages
 *   opencode:session:prompt    → agent:send
 *   opencode:session:respond   → agent:respond-permission
 *   opencode:session:abort     → agent:abort
 *   opencode:session:create    → agent:dispatch
 *   opencode:diff              → project:diff
 *   opencode:todo              → project:todo
 *
 * The old opencode.ts handlers remain registered alongside these for
 * backwards compatibility during the transition. Remove opencode.ts
 * registration from index.ts once all renderer calls are migrated.
 */
import { safeHandle } from './_helpers'
import { runCmd, validPath, waitForClientConnected } from '../util/shell'
import type { AdapterRegistry } from '../adapters/registry'
import type { OpencodeHttpAdapter } from '../adapters/opencode-http/adapter'

let _registry: AdapterRegistry | null = null
let _opencodeAdapter: OpencodeHttpAdapter | null = null

export function init(registry: AdapterRegistry, opencodeAdapter: OpencodeHttpAdapter): void {
  _registry = registry
  _opencodeAdapter = opencodeAdapter
}

export function register(broadcast: (channel: string, payload: unknown) => void): void {
  safeHandle('agent:snapshot', () => {
    if (!_registry) return { projects: [], aggregateStatus: { status: 'disabled', perInstance: [] } }
    return _registry.snapshot()
  })

  safeHandle('agent:messages', async (_e, sessionId: string) => {
    if (!_registry) return []
    return _registry.fetchMessages(sessionId)
  })

  safeHandle('agent:send', async (_e, sessionId: string, text: string) => {
    if (!_registry) throw new Error('registry not initialized')
    await _registry.send(sessionId, text)
    return { ok: true }
  })

  safeHandle(
    'agent:respond-permission',
    async (
      _e,
      sessionId: string,
      permissionId: string,
      response: 'once' | 'always' | 'reject'
    ) => {
      if (!_registry) throw new Error('registry not initialized')
      await _registry.respondPermission(sessionId, permissionId, response)
      return { ok: true }
    }
  )

  safeHandle('agent:send-command', async (_e, sessionId: string, command: string, args: string) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(command)) throw new Error(`invalid command name: ${command}`)
    if (!_registry) throw new Error('registry not initialized')
    return _registry.sendCommand(sessionId, command, args)
  })

  safeHandle('agent:list-commands', async (_e, sessionId: string) => {
    if (!_registry) return []
    return _registry.listCommands(sessionId)
  })

  safeHandle('agent:abort', async (_e, sessionId: string) => {
    if (!_registry) throw new Error('registry not initialized')
    await _registry.abort(sessionId)
    return { ok: true }
  })

  safeHandle(
    'agent:dispatch',
    async (
      _e,
      args: { instanceKey?: string; directory: string; prompt: string; title?: string; profileId?: string }
    ) => {
      if (!_opencodeAdapter) throw new Error('opencode adapter not initialized')
      const adapter = _opencodeAdapter

      // Legacy path: instanceKey-based dispatch to a running configured client.
      if (!args.profileId) {
        const maybeClient = args.instanceKey
          ? adapter.findClientByKey(args.instanceKey)
          : adapter.firstClient()
        if (!maybeClient) throw new Error('no opencode client available')
        const client = maybeClient
        await waitForClientConnected(client)
        const id = await client.createSession(args.directory, args.title)
        await client.sendPrompt(id, args.prompt)
        return { sessionId: id }
      }

      return adapter.dispatch({
        profileId: args.profileId,
        directory: args.directory,
        prompt: args.prompt,
        title: args.title
      })
    }
  )

  safeHandle('project:diff', async (_e, path: string) => {
    if (!validPath(path)) throw new Error('invalid path')
    return runCmd('git', ['-C', path, 'diff', '--no-color'], path)
  })

  safeHandle('project:todo', async (_e, path: string) => {
    if (!validPath(path)) throw new Error('invalid path')
    return runCmd('td', ['usage', '-q', '-w', path], path)
  })
}

export function attachBroadcast(
  registry: AdapterRegistry,
  broadcast: (channel: string, payload: unknown) => void
): void {
  registry.removeAllListeners('change')
  registry.on('change', () => {
    broadcast('agent:snapshot', registry.snapshot())
  })
}

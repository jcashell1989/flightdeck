import { configStore } from '../config/store'
import { opencodeRegistry } from '../opencode/registry'
import { opencodeLauncher } from '../opencode/launcher'
import { safeHandle } from './_helpers'
import { waitForClientConnected } from '../util/shell'
import type { ClaudeLauncher } from '../claude/launcher'

export function register(claudeLauncher: ClaudeLauncher): void {
  safeHandle(
    'instance:dispatch',
    async (_e, args: { profileId: string; directory: string; prompt: string; sessionId?: string }) => {
      const cfg = configStore.get()
      const profile = cfg.profiles.find((p) => p.id === args.profileId)
      if (!profile) throw new Error(`profile ${args.profileId} not found`)

      if (profile.agentType === 'claude-code') {
        if (args.sessionId) {
          const result = await claudeLauncher.resume(args.sessionId, profile, args.directory, args.prompt)
          return { sessionId: result.sessionId }
        }
        const result = await claudeLauncher.launch(profile, args.directory, args.prompt)
        return { sessionId: result.sessionId }
      }

      if (profile.agentType === 'opencode') {
        // Launch (or reuse) the managed opencode serve instance.
        const port = await opencodeLauncher.launch(profile, args.directory)
        const managedKey = `managed:${args.profileId}:${args.directory}`
        const instance = { host: '127.0.0.1', port, label: profile.label }

        // Ensure the registry has a connected client for this instance.
        const client = opencodeRegistry.ensureManagedClient(instance, managedKey)

        await waitForClientConnected(client)

        const sessionId = await client.createSession(args.directory)
        await client.sendPrompt(sessionId, args.prompt)
        return { sessionId }
      }

      throw new Error(`unsupported agent type: ${profile.agentType}`)
    }
  )
}

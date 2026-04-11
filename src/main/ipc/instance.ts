import { configStore } from '../config/store'
import { opencodeRegistry } from '../opencode/registry'
import { opencodeLauncher } from '../opencode/launcher'
import { safeHandle } from './_helpers'
import { waitForClientConnected } from '../util/shell'

export function register(): void {
  safeHandle(
    'instance:dispatch',
    async (_e, args: { profileId: string; directory: string; prompt: string }) => {
      const cfg = configStore.get()
      const profile = cfg.profiles.find((p) => p.id === args.profileId)
      if (!profile) throw new Error(`profile ${args.profileId} not found`)
      if (profile.agentType !== 'opencode') {
        throw new Error(`profile ${args.profileId} is not an opencode profile`)
      }

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
  )
}

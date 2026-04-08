import { configStore } from '../config/store'
import { opencodeRegistry } from '../opencode/registry'
import { opencodeLauncher } from '../opencode/launcher'
import { safeHandle } from './_helpers'

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

      // Wait for the client to reach 'connected'. Use .on (not .once) so that
      // intermediate 'reconnecting' or 'connecting' events don't consume the
      // listener before 'connected' arrives.
      await new Promise<void>((resolve, reject) => {
        if (client.snapshot().status === 'connected') return resolve()
        const timeout = setTimeout(() => {
          client.off('status', onStatus)
          reject(new Error('client connect timeout'))
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

      const sessionId = await client.createSession(args.directory)
      await client.sendPrompt(sessionId, args.prompt)
      return { sessionId }
    }
  )
}

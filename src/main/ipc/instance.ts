import { configStore } from '../config/store'
import { opencodeHttpAdapter } from '../adapters/opencode-http/adapter'
import { safeHandle } from './_helpers'
import { validPath } from '../util/shell'
import type { ClaudeLauncher } from '../adapters/claude-file-watch/launcher'

export function register(claudeLauncher: ClaudeLauncher): void {
  safeHandle(
    'instance:dispatch',
    async (_e, args: { profileId: string; directory: string; prompt: string; sessionId?: string }) => {
      if (!validPath(args.directory)) throw new Error(`invalid directory: ${args.directory}`)
      const cfg = configStore.get()
      const profile = cfg.profiles.find((p) => p.id === args.profileId)
      if (!profile) throw new Error(`profile ${args.profileId} not found`)

      if (profile.agentType === 'claude-code') {
        if (args.sessionId) {
          const sid = args.sessionId.trim()
          if (!/^[a-zA-Z0-9_-]+$/.test(sid)) {
            throw new Error(`invalid sessionId format: ${args.sessionId}`)
          }
          const result = await claudeLauncher.resume(sid, profile, args.directory, args.prompt)
          return { sessionId: result.sessionId }
        }
        const result = await claudeLauncher.launch(profile, args.directory, args.prompt)
        return { sessionId: result.sessionId }
      }

      if (profile.agentType === 'opencode') {
        return opencodeHttpAdapter.dispatch({
          profileId: args.profileId,
          directory: args.directory,
          prompt: args.prompt,
          sessionId: args.sessionId
        })
      }

      throw new Error(`unsupported agent type: ${profile.agentType}`)
    }
  )
}

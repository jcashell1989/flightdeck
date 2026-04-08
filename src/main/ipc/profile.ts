import { configStore, AgentProfile } from '../config/store'
import { safeHandle } from './_helpers'

export function register(): void {
  safeHandle('profile:list', () => {
    return configStore.get().profiles
  })

  safeHandle('profile:add', async (_e, p: Omit<AgentProfile, 'id'>) => {
    const id = crypto.randomUUID()
    const profile: AgentProfile = { ...p, id }
    const cfg = configStore.get()
    await configStore.set({ profiles: [...cfg.profiles, profile] })
    return profile
  })

  safeHandle('profile:update', async (_e, p: AgentProfile) => {
    const cfg = configStore.get()
    const profiles = cfg.profiles.map((existing) => (existing.id === p.id ? p : existing))
    await configStore.set({ profiles })
    return p
  })

  safeHandle('profile:delete', async (_e, id: string) => {
    const cfg = configStore.get()
    const profiles = cfg.profiles.filter((p) => p.id !== id)
    await configStore.set({ profiles })
    return { ok: true }
  })
}

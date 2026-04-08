import { nativeTheme } from 'electron'
import { configStore } from '../config/store'
import { safeHandle } from './_helpers'

export function register(broadcast: (channel: string, payload: unknown) => void): void {
  safeHandle('get-theme', () => {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  })

  safeHandle('config:get', () => configStore.get())
  safeHandle('config:set', (_e, patch: unknown) => configStore.set(patch))

  // Remove any prior change listener before attaching a fresh one, so HMR
  // re-registration doesn't stack up duplicate broadcasts.
  configStore.removeAllListeners('change')
  configStore.on('change', (cfg) => broadcast('config-changed', cfg))
}

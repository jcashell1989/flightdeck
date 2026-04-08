import { ipcMain, nativeTheme } from 'electron'
import { configStore } from '../config/store'

export function register(broadcast: (channel: string, payload: unknown) => void): void {
  ipcMain.handle('get-theme', () => {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  })

  ipcMain.handle('config:get', () => configStore.get())
  ipcMain.handle('config:set', (_e, patch: unknown) => configStore.set(patch))

  configStore.on('change', (cfg) => broadcast('config-changed', cfg))
}

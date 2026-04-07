import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'

export interface OpencodeInstance {
  host: string
  port: number
  label?: string
}

export interface AppConfig {
  opencode: { instances: OpencodeInstance[] }
  mock: { enabled: boolean }
}

contextBridge.exposeInMainWorld('electronAPI', {
  getTheme: (): Promise<'dark' | 'light'> => ipcRenderer.invoke('get-theme'),
  onThemeChanged: (callback: (theme: 'dark' | 'light') => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, theme: 'dark' | 'light'): void => callback(theme)
    ipcRenderer.on('theme-changed', handler)
    return () => ipcRenderer.removeListener('theme-changed', handler)
  },
  config: {
    get: (): Promise<AppConfig> => ipcRenderer.invoke('config:get'),
    set: (patch: Partial<AppConfig>): Promise<AppConfig> => ipcRenderer.invoke('config:set', patch),
    onChange: (cb: (cfg: AppConfig) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, cfg: AppConfig): void => cb(cfg)
      ipcRenderer.on('config-changed', handler)
      return () => ipcRenderer.removeListener('config-changed', handler)
    }
  }
})

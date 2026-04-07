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

export interface OpencodeSnapshotPayload {
  projects: Array<{
    id: string
    name: string
    path: string
    sessions: Array<{
      id: string
      agentType: 'opencode'
      state: 'running' | 'idle' | 'approval' | 'question' | 'error'
      currentAction: string
      startedAt: number
      lastActivity: number
      projectId: string
    }>
  }>
  aggregateStatus: {
    status: 'disabled' | 'connecting' | 'connected' | 'reconnecting' | 'error'
    perInstance: Array<{
      key: string
      status: 'connecting' | 'connected' | 'reconnecting' | 'error'
      lastError: string | null
    }>
  }
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
  },
  opencode: {
    getSnapshot: (): Promise<OpencodeSnapshotPayload> => ipcRenderer.invoke('opencode:snapshot'),
    onSnapshot: (cb: (snap: OpencodeSnapshotPayload) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, snap: OpencodeSnapshotPayload): void => cb(snap)
      ipcRenderer.on('opencode:snapshot', handler)
      return () => ipcRenderer.removeListener('opencode:snapshot', handler)
    }
  }
})

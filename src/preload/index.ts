import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type {
  AgentProfile,
  AppConfig,
  CommandDefinition,
  GitStatusResult,
  MessageRecord,
  OpencodeSnapshotPayload,
  ProcessResult,
  ProjectConfig,
  ProjectValidationResult
} from '../shared/types'

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
    },
    getMessages: (sessionId: string): Promise<MessageRecord[]> =>
      ipcRenderer.invoke('opencode:session:messages', sessionId),
    sendPrompt: (sessionId: string, text: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('opencode:session:prompt', sessionId, text),
    respondPermission: (
      sessionId: string,
      permissionId: string,
      response: 'once' | 'always' | 'reject'
    ): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('opencode:session:respond', sessionId, permissionId, response),
    abortSession: (sessionId: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('opencode:session:abort', sessionId),
    sendCommand: (sessionId: string, command: string, args: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('opencode:session:command', sessionId, command, args),
    listCommands: (sessionId: string): Promise<CommandDefinition[]> =>
      ipcRenderer.invoke('opencode:commands:list', sessionId),
    createSession: (args: {
      instanceKey?: string
      directory: string
      prompt: string
      title?: string
    }): Promise<{ sessionId: string }> => ipcRenderer.invoke('opencode:session:create', args),
    getDiff: (path: string): Promise<ProcessResult> => ipcRenderer.invoke('opencode:diff', path),
    getTodo: (path: string): Promise<ProcessResult> => ipcRenderer.invoke('opencode:todo', path)
  },
  project: {
    validate: (path: string): Promise<ProjectValidationResult> =>
      ipcRenderer.invoke('project:validate', path),
    browse: (): Promise<string | null> => ipcRenderer.invoke('project:browse'),
    add: (args: { path: string; name?: string; gitInit?: boolean; defaultAgent?: ProjectConfig['defaultAgent'] }): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('project:add', args),
    gitStatus: (path: string): Promise<GitStatusResult> =>
      ipcRenderer.invoke('project:gitStatus', path),
    archive: (path: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('project:archive', path),
    restore: (path: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('project:restore', path),
    delete: (path: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('project:delete', path)
  },
  profile: {
    list: (): Promise<AgentProfile[]> => ipcRenderer.invoke('profile:list'),
    add: (p: Omit<AgentProfile, 'id'>): Promise<AgentProfile> =>
      ipcRenderer.invoke('profile:add', p),
    update: (p: AgentProfile): Promise<AgentProfile> => ipcRenderer.invoke('profile:update', p),
    delete: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('profile:delete', id)
  },
  instance: {
    dispatch: (args: {
      profileId: string
      directory: string
      prompt: string
    }): Promise<{ sessionId: string }> => ipcRenderer.invoke('instance:dispatch', args)
  },
  http: {
    onStatus: (cb: (status: { status: string; host?: string; port?: number; message?: string }) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, payload: { status: string; host?: string; port?: number; message?: string }): void => cb(payload)
      ipcRenderer.on('http:status', handler)
      return () => ipcRenderer.removeListener('http:status', handler)
    }
  }
})

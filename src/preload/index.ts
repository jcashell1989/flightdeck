import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'

export interface OpencodeInstance {
  host: string
  port: number
  label?: string
}

export interface ProjectConfig {
  path: string
  name?: string
  archived: boolean
}

export interface AgentProfile {
  id: string
  label: string
  agentType: 'opencode' | 'claude-code'
  provider?: string
  model?: string
  apiKey?: string
  isDefault: boolean
}

export interface AppConfig {
  opencode: { instances: OpencodeInstance[] }
  mock: { enabled: boolean }
  projects: ProjectConfig[]
  profiles: AgentProfile[]
}

export interface PendingPermissionPayload {
  id: string
  type: string
  title?: string
  pattern?: string
  command?: string
  metadata: Record<string, unknown>
}

export interface OpencodeSnapshotPayload {
  projects: Array<{
    id: string
    name: string
    path: string
    sessions: Array<{
      id: string
      agentType: 'opencode' | 'claude-code'
      state: 'running' | 'idle' | 'approval' | 'question' | 'error'
      currentAction: string
      startedAt: number
      lastActivity: number
      projectId: string
      instanceKey: string
      pendingPermission?: PendingPermissionPayload | null
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

export interface ProcessResult {
  stdout: string
  stderr: string
  code: number
}

export interface MessageRecord {
  info: unknown
  parts: unknown[]
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
    validate: (path: string): Promise<{ valid: boolean; reason?: string; isGitRepo?: boolean }> =>
      ipcRenderer.invoke('project:validate', path),
    browse: (): Promise<string | null> => ipcRenderer.invoke('project:browse'),
    add: (args: { path: string; name?: string; gitInit?: boolean }): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('project:add', args),
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
  }
})

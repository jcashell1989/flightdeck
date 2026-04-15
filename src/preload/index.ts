import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type {
  AgentProfile,
  AnalyticsSummary,
  AppConfig,
  CodexSnapshot,
  CommandDefinition,
  GitStatusResult,
  MessageRecord,
  OpencodeSnapshotPayload,
  ProcessResult,
  ProjectConfig,
  ProjectValidationResult,
  TdTicket,
  TdUsageResult
} from '../shared/types'
import { TD_DEFAULT_WATCH_KEY } from '../shared/td'

const pendingWatchOpsByCwd = new Map<string, Promise<unknown>>()

function queueTdWatchOp(cwd: string | undefined, channel: 'td:watch' | 'td:unwatch'): void {
  const key = cwd ?? TD_DEFAULT_WATCH_KEY
  const previous = pendingWatchOpsByCwd.get(key) ?? Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(() => ipcRenderer.invoke(channel, cwd))
    .finally(() => {
      if (pendingWatchOpsByCwd.get(key) === next) pendingWatchOpsByCwd.delete(key)
    })
  pendingWatchOpsByCwd.set(key, next)
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
    getSnapshot: (): Promise<OpencodeSnapshotPayload> => ipcRenderer.invoke('agent:snapshot'),
    onSnapshot: (cb: (snap: OpencodeSnapshotPayload) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, snap: OpencodeSnapshotPayload): void => cb(snap)
      ipcRenderer.on('agent:snapshot', handler)
      return () => ipcRenderer.removeListener('agent:snapshot', handler)
    },
    getMessages: (sessionId: string): Promise<MessageRecord[]> =>
      ipcRenderer.invoke('agent:messages', sessionId),
    sendPrompt: (sessionId: string, text: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('agent:send', sessionId, text),
    respondPermission: (
      sessionId: string,
      permissionId: string,
      response: 'once' | 'always' | 'reject'
    ): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('agent:respond-permission', sessionId, permissionId, response),
    abortSession: (sessionId: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('agent:abort', sessionId),
    sendCommand: (sessionId: string, command: string, args: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('agent:send-command', sessionId, command, args),
    listCommands: (sessionId: string): Promise<CommandDefinition[]> =>
      ipcRenderer.invoke('agent:list-commands', sessionId),
    getSessionLogs: (sessionId: string): Promise<string[]> =>
      ipcRenderer.invoke('agent:logs', sessionId),
    createSession: (args: {
      instanceKey?: string
      directory: string
      prompt: string
      title?: string
    }): Promise<{ sessionId: string }> => ipcRenderer.invoke('agent:dispatch', args),
    getDiff: (path: string): Promise<ProcessResult> => ipcRenderer.invoke('project:diff', path),
    onPermissionRequest: (cb: (payload: { sessionId: string; requestId: string; toolName: string; input: Record<string, unknown>; toolUseId: string }) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, payload: { sessionId: string; requestId: string; toolName: string; input: Record<string, unknown>; toolUseId: string }): void => cb(payload)
      ipcRenderer.on('agent:permission_request', handler)
      return () => ipcRenderer.removeListener('agent:permission_request', handler)
    },
    onStreamUpdate: (cb: (payload: { sessionId: string; currentAction: string; state: string }) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, payload: { sessionId: string; currentAction: string; state: string }): void => cb(payload)
      ipcRenderer.on('agent:stream_update', handler)
      return () => ipcRenderer.removeListener('agent:stream_update', handler)
    }
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
      sessionId?: string
    }): Promise<{ sessionId: string }> => ipcRenderer.invoke('instance:dispatch', args)
  },
  http: {
    onStatus: (cb: (status: { status: string; host?: string; port?: number; message?: string }) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, payload: { status: string; host?: string; port?: number; message?: string }): void => cb(payload)
      ipcRenderer.on('http:status', handler)
      return () => ipcRenderer.removeListener('http:status', handler)
    }
  },
  analytics: {
    getSummary: (): Promise<AnalyticsSummary> => ipcRenderer.invoke('analytics:summary'),
    onSummary: (cb: (summary: AnalyticsSummary) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, s: AnalyticsSummary): void => cb(s)
      ipcRenderer.on('analytics:summary', handler)
      return () => ipcRenderer.removeListener('analytics:summary', handler)
    }
  },
  codex: {
    getSnapshot: (): Promise<CodexSnapshot> => ipcRenderer.invoke('codex:snapshot'),
    onSnapshot: (cb: (snap: CodexSnapshot) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, snap: CodexSnapshot): void => cb(snap)
      ipcRenderer.on('codex:snapshot', handler)
      return () => ipcRenderer.removeListener('codex:snapshot', handler)
    }
  },
  td: {
    list: (cwd?: string): Promise<TdTicket[]> => ipcRenderer.invoke('td:list', cwd),
    show: (id: string, cwd?: string): Promise<TdTicket | null> => ipcRenderer.invoke('td:show', id, cwd),
    start: (id: string, cwd?: string): Promise<void> => ipcRenderer.invoke('td:start', id, cwd),
    log: (id: string, message: string, cwd?: string): Promise<void> => ipcRenderer.invoke('td:log', id, message, cwd),
    handoff: (id: string, cwd?: string): Promise<void> => ipcRenderer.invoke('td:handoff', id, cwd),
    usage: (cwd?: string): Promise<TdUsageResult> => ipcRenderer.invoke('td:usage', cwd),
    onTdChange: (cwd: string | undefined, cb: () => void): (() => void) => {
      const expectedCwd = cwd ?? null
      const handler = (_event: IpcRendererEvent, payload?: { cwd?: string | null }): void => {
        if ((payload?.cwd ?? null) === expectedCwd) cb()
      }
      ipcRenderer.on('td:change', handler)
      queueTdWatchOp(cwd, 'td:watch')
      return () => {
        ipcRenderer.removeListener('td:change', handler)
        queueTdWatchOp(cwd, 'td:unwatch')
      }
    }
  }
})

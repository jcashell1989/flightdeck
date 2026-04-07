import { AppConfig, Session, Project } from './types'

export interface OpencodeSnapshotPayload {
  projects: Project[]
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
  info: {
    id: string
    role: 'user' | 'assistant' | string
    time?: { created: number }
    [k: string]: unknown
  }
  parts: Array<{
    id?: string
    type: string
    text?: string
    filename?: string
    tool?: string
    state?: { status?: string; output?: string; input?: unknown }
    [k: string]: unknown
  }>
}

export interface ElectronAPI {
  getTheme: () => Promise<'dark' | 'light'>
  onThemeChanged: (cb: (theme: 'dark' | 'light') => void) => () => void
  config: {
    get: () => Promise<AppConfig>
    set: (patch: Partial<AppConfig>) => Promise<AppConfig>
    onChange: (cb: (cfg: AppConfig) => void) => () => void
  }
  opencode: {
    getSnapshot: () => Promise<OpencodeSnapshotPayload>
    onSnapshot: (cb: (snap: OpencodeSnapshotPayload) => void) => () => void
    getMessages: (sessionId: string) => Promise<MessageRecord[]>
    sendPrompt: (sessionId: string, text: string) => Promise<{ ok: boolean }>
    respondPermission: (
      sessionId: string,
      permissionId: string,
      response: 'once' | 'always' | 'reject'
    ) => Promise<{ ok: boolean }>
    abortSession: (sessionId: string) => Promise<{ ok: boolean }>
    createSession: (args: {
      instanceKey?: string
      directory: string
      prompt: string
      title?: string
    }) => Promise<{ sessionId: string }>
    getDiff: (path: string) => Promise<ProcessResult>
    getTodo: (path: string) => Promise<ProcessResult>
  }
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

// Satisfy the TS 'isolatedModules' rule — make this file a module.
export {}

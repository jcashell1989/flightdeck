import type {
  AgentProfile,
  AppConfig,
  MessageRecord,
  OpencodeSnapshotPayload,
  ProcessResult,
  ProjectValidationResult
} from './types'

// Re-export for backward compat with earlier `import { MessageRecord } from '../electronAPI'`.
// New code should import these directly from './types' → shared/types.
export type { MessageRecord, OpencodeSnapshotPayload, ProcessResult }

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
  project: {
    validate: (path: string) => Promise<ProjectValidationResult>
    browse: () => Promise<string | null>
    add: (args: { path: string; name?: string; gitInit?: boolean }) => Promise<{ ok: boolean }>
    archive: (path: string) => Promise<{ ok: boolean }>
    restore: (path: string) => Promise<{ ok: boolean }>
    delete: (path: string) => Promise<{ ok: boolean }>
  }
  profile: {
    list: () => Promise<AgentProfile[]>
    add: (p: Omit<AgentProfile, 'id'>) => Promise<AgentProfile>
    update: (p: AgentProfile) => Promise<AgentProfile>
    delete: (id: string) => Promise<{ ok: boolean }>
  }
  instance: {
    dispatch: (args: {
      profileId: string
      directory: string
      prompt: string
    }) => Promise<{ sessionId: string }>
  }
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

// Satisfy the TS 'isolatedModules' rule — make this file a module.
export {}

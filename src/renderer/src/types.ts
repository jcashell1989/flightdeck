export type SessionState = 'running' | 'idle' | 'approval' | 'question' | 'review' | 'error'

export interface Session {
  id: string
  agentType: 'opencode' | 'claude-code'
  state: SessionState
  currentAction: string
  startedAt: number
  lastActivity: number
  projectId: string
}

export interface Project {
  id: string
  name: string
  path: string
  sessions: Session[]
}

export type View = 'dashboard' | 'sessions' | 'projects' | 'settings'

// Attention states: anything that wants the user's eyes.
// `idle` is here because an idle agent with no reason to be idle is a problem.
// `review` is reserved for Phase 3 (needs diff/watermark signal) and is currently never assigned.
export const ATTENTION_STATES: ReadonlySet<SessionState> = new Set([
  'approval',
  'question',
  'error',
  'idle'
])

export function isAttention(state: SessionState): boolean {
  return ATTENTION_STATES.has(state)
}

export interface OpencodeInstance {
  host: string
  port: number
  label?: string
}

export interface AppConfig {
  opencode: { instances: OpencodeInstance[] }
  mock: { enabled: boolean }
}

export type ConnectionStatus = 'disabled' | 'connecting' | 'connected' | 'reconnecting' | 'error'

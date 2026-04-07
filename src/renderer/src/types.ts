export type SessionState = 'running' | 'idle' | 'approval' | 'question' | 'review' | 'error'

export interface Session {
  id: string
  agentType: 'opencode' | 'claude-code'
  state: SessionState
  currentAction: string
  startedAt: number
  lastActivity: number
  elapsedMs: number
  projectId: string
}

export interface Project {
  id: string
  name: string
  path: string
  sessions: Session[]
}

export type View = 'dashboard' | 'sessions' | 'projects' | 'settings'

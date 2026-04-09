// Pure sort/filter helpers for the Sessions view. Extracted from
// Sessions.tsx so they can be unit-tested under the Node vitest env
// without pulling in a React import.

import { Session, SessionState } from '../types'

export const STATUS_LABELS: Record<SessionState, string> = {
  running: 'Running',
  idle: 'Idle',
  approval: 'Needs Approval',
  question: 'Has Question',
  review: 'Review Changes',
  error: 'Error'
}

export type SortKey = 'status' | 'agent' | 'id' | 'project' | 'action' | 'activity'

export interface FlatSession extends Session {
  projectName: string
}

export function compareBy(a: FlatSession, b: FlatSession, key: SortKey): number {
  switch (key) {
    case 'status':
      return STATUS_LABELS[a.state].localeCompare(STATUS_LABELS[b.state])
    case 'agent':
      return a.agentType.localeCompare(b.agentType)
    case 'id':
      return a.id.localeCompare(b.id)
    case 'project':
      return a.projectName.localeCompare(b.projectName)
    case 'action':
      return (a.currentAction ?? '').localeCompare(b.currentAction ?? '')
    case 'activity':
      return a.lastActivity - b.lastActivity
  }
}

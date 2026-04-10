import { Project } from './types'
import type { MessageRecord } from './electronAPI'

/**
 * Fixture message history for mock mode — keyed loosely by sessionId so each
 * card's drill-down renders something distinct. Used by useSessionDetail.
 */
export function mockMessages(sessionId: string): MessageRecord[] {
  const baseTime = Date.now() - 300_000
  return [
    {
      info: { id: `${sessionId}-m1`, role: 'user', time: { created: baseTime } },
      parts: [
        {
          id: `${sessionId}-m1-p1`,
          type: 'text',
          text: 'Refactor the auth middleware to use the new JWT library.'
        }
      ]
    },
    {
      info: { id: `${sessionId}-m2`, role: 'assistant', time: { created: baseTime + 20_000 } },
      parts: [
        {
          id: `${sessionId}-m2-p1`,
          type: 'text',
          text: "I'll start by reading the current implementation."
        },
        {
          id: `${sessionId}-m2-p2`,
          type: 'tool',
          tool: 'read',
          state: { status: 'completed', output: 'src/middleware/auth.ts — 142 lines' }
        }
      ]
    },
    {
      info: { id: `${sessionId}-m3`, role: 'assistant', time: { created: baseTime + 60_000 } },
      parts: [
        {
          id: `${sessionId}-m3-p1`,
          type: 'text',
          text: 'The current implementation uses a custom hand-rolled verifier. Switching to jose now.'
        },
        {
          id: `${sessionId}-m3-p2`,
          type: 'tool',
          tool: 'edit',
          state: { status: 'completed', output: 'Modified src/middleware/auth.ts' }
        }
      ]
    }
  ]
}


// NOTE (R-L7): using a function so relative timestamps stay accurate over long
// app sessions rather than drifting from a fixed module-load baseline.
const now = () => Date.now()

export const mockProjects: Project[] = [
  {
    id: 'auth-service',
    name: 'auth-service',
    path: '/Users/julian/projects/auth-service',
    sessions: [
      {
        id: '4a2f',
        agentType: 'opencode',
        state: 'running',
        currentAction: 'editing src/middleware/auth.ts',
        startedAt: now() - 134_000,
        lastActivity: now() - 12_000,
        projectId: 'auth-service'
      },
      {
        id: '7b3e',
        agentType: 'opencode',
        state: 'approval',
        currentAction: 'waiting: approve shell command `npm test`',
        startedAt: now() - 300_000,
        lastActivity: now() - 45_000,
        projectId: 'auth-service'
      },
      {
        id: 'c91a',
        agentType: 'claude-code',
        state: 'question',
        currentAction: 'asking: which auth provider to use?',
        startedAt: now() - 180_000,
        lastActivity: now() - 60_000,
        projectId: 'auth-service'
      }
    ]
  },
  {
    id: 'api-gateway',
    name: 'api-gateway',
    path: '/Users/julian/projects/api-gateway',
    sessions: [
      {
        id: '2d5f',
        agentType: 'opencode',
        state: 'idle',
        currentAction: 'idle — last action: ran tests',
        startedAt: now() - 600_000,
        lastActivity: now() - 120_000,
        projectId: 'api-gateway'
      },
      {
        id: 'e8c2',
        agentType: 'opencode',
        state: 'error',
        currentAction: 'failed: npm run build exited with code 1',
        startedAt: now() - 900_000,
        lastActivity: now() - 800_000,
        projectId: 'api-gateway'
      }
    ]
  },
  {
    id: 'frontend-app',
    name: 'frontend-app',
    path: '/Users/julian/projects/frontend-app',
    sessions: [
      {
        id: 'f3a1',
        agentType: 'claude-code',
        state: 'idle',
        currentAction: 'idle — completed: refactored login component',
        startedAt: now() - 1_200_000,
        lastActivity: now() - 1_100_000,
        projectId: 'frontend-app'
      }
    ]
  }
]

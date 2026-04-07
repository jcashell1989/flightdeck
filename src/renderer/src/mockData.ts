import { Project } from './types'

const now = Date.now()

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
        startedAt: now - 134_000,
        lastActivity: now - 12_000,
        elapsedMs: 134_000,
        projectId: 'auth-service'
      },
      {
        id: '7b3e',
        agentType: 'opencode',
        state: 'approval',
        currentAction: 'waiting: approve shell command `npm test`',
        startedAt: now - 300_000,
        lastActivity: now - 45_000,
        elapsedMs: 300_000,
        projectId: 'auth-service'
      },
      {
        id: 'c91a',
        agentType: 'claude-code',
        state: 'question',
        currentAction: 'asking: which auth provider to use?',
        startedAt: now - 180_000,
        lastActivity: now - 60_000,
        elapsedMs: 180_000,
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
        state: 'review',
        currentAction: 'done — 14 files changed',
        startedAt: now - 600_000,
        lastActivity: now - 120_000,
        elapsedMs: 480_000,
        projectId: 'api-gateway'
      },
      {
        id: 'e8c2',
        agentType: 'opencode',
        state: 'error',
        currentAction: 'failed: npm run build exited with code 1',
        startedAt: now - 900_000,
        lastActivity: now - 800_000,
        elapsedMs: 100_000,
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
        currentAction: 'completed: refactored login component',
        startedAt: now - 1_200_000,
        lastActivity: now - 1_100_000,
        elapsedMs: 100_000,
        projectId: 'frontend-app'
      }
    ]
  }
]

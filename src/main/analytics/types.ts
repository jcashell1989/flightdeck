export interface ClaudeCodeSessionUsage {
  sessionId: string
  projectPath: string
  inputTokens: number
  outputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
  model: string
  messageCount: number
}

export interface OpencodeSessionCost {
  sessionId: string
  projectPath: string
  realCostUsd: number
  messageCount: number
  totalInputTokens: number
  totalOutputTokens: number
}

export interface ProjectAnalytics {
  projectPath: string
  projectName: string
  claudeCodeUsage: ClaudeCodeSessionUsage[]
  opencodeSessions: OpencodeSessionCost[]
  totalOpencodeCostUsd: number
}

export interface AnalyticsSummary {
  projects: ProjectAnalytics[]
  generatedAt: number
}

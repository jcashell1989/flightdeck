import { EventEmitter } from 'events'
import { basename } from 'path'
import { ClaudeCodeAnalyticsCollector } from './claude-collector'
import { OpencodeAnalyticsCollector } from './opencode-collector'
import type { AnalyticsSummary, ProjectAnalytics } from './types'

export class AnalyticsMonitor extends EventEmitter {
  private claudeCollector = new ClaudeCodeAnalyticsCollector()
  private opencodeCollector = new OpencodeAnalyticsCollector()

  start(): void {
    this.claudeCollector.on('change', () => this.emit('change'))
    this.opencodeCollector.on('change', () => this.emit('change'))
    this.claudeCollector.start()
    this.opencodeCollector.start()
  }

  dispose(): void {
    this.claudeCollector.dispose()
    this.opencodeCollector.dispose()
    this.removeAllListeners()
  }

  getSummary(): AnalyticsSummary {
    const claudeUsage = this.claudeCollector.getUsage()
    const opencodeSessions = this.opencodeCollector.getSessions()

    // Union of all project paths
    const projectMap = new Map<string, ProjectAnalytics>()

    const getOrCreate = (projectPath: string): ProjectAnalytics => {
      let p = projectMap.get(projectPath)
      if (!p) {
        p = {
          projectPath,
          projectName: basename(projectPath) || projectPath,
          claudeCodeUsage: [],
          opencodeSessions: [],
          totalOpencodeCostUsd: 0
        }
        projectMap.set(projectPath, p)
      }
      return p
    }

    for (const usage of claudeUsage) {
      const p = getOrCreate(usage.projectPath)
      p.claudeCodeUsage.push(usage)
    }

    for (const session of opencodeSessions) {
      const p = getOrCreate(session.projectPath)
      p.opencodeSessions.push(session)
      p.totalOpencodeCostUsd += session.realCostUsd
    }

    return {
      projects: Array.from(projectMap.values()),
      generatedAt: Date.now()
    }
  }
}

export const analyticsMonitor = new AnalyticsMonitor()

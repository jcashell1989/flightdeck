import { EventEmitter } from 'events'
import chokidar, { FSWatcher } from 'chokidar'
import fs from 'fs/promises'
import { join, basename } from 'path'
import { homedir } from 'os'
import type { OpencodeSessionCost } from './types'

function opencodeStorageRoot(): string {
  const xdg = process.env['XDG_DATA_HOME']
  const base = xdg ?? join(homedir(), '.local', 'share')
  return join(base, 'opencode', 'storage')
}

interface MessageEntry {
  cost: number
  inputTokens: number
  outputTokens: number
}

interface StorageMessage {
  id?: string
  sessionID?: string
  cost?: number
  tokens?: {
    input?: number
    output?: number
    reasoning?: number
    cache?: { read?: number; write?: number }
  }
}

interface StorageSession {
  id?: string
  projectID?: string
}

interface StorageProject {
  id?: string
  worktree?: string
}

export class OpencodeAnalyticsCollector extends EventEmitter {
  private watcher: FSWatcher | null = null
  // Map<sessionID, Map<messageId, MessageEntry>>
  private data = new Map<string, Map<string, MessageEntry>>()
  // Map<sessionID, projectPath>
  private projectPaths = new Map<string, string>()

  start(): void {
    const messageDir = join(opencodeStorageRoot(), 'message')
    // Watch silently — directory may not exist
    this.watcher = chokidar.watch(messageDir, {
      depth: 2,
      ignoreInitial: false,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 }
    })

    this.watcher.on('add', (filePath: string) => {
      if (!filePath.endsWith('.json')) return
      void this.readMessage(filePath)
    })

    this.watcher.on('change', (filePath: string) => {
      if (!filePath.endsWith('.json')) return
      void this.readMessage(filePath)
    })

    this.watcher.on('error', () => {
      // Directory missing or unreadable — start with empty data
    })
  }

  dispose(): void {
    void this.watcher?.close()
    this.watcher = null
    this.data.clear()
    this.projectPaths.clear()
  }

  getSessions(): OpencodeSessionCost[] {
    const results: OpencodeSessionCost[] = []
    for (const [sessionId, messages] of this.data) {
      let realCostUsd = 0
      let totalInputTokens = 0
      let totalOutputTokens = 0
      for (const entry of messages.values()) {
        realCostUsd += entry.cost
        totalInputTokens += entry.inputTokens
        totalOutputTokens += entry.outputTokens
      }
      const projectPath = this.projectPaths.get(sessionId) ?? sessionId
      results.push({
        sessionId,
        projectPath,
        realCostUsd,
        messageCount: messages.size,
        totalInputTokens,
        totalOutputTokens
      })
    }
    return results
  }

  private async readMessage(filePath: string): Promise<void> {
    try {
      const raw = await fs.readFile(filePath, 'utf8')
      const data = JSON.parse(raw) as StorageMessage
      const msgId = data.id
      const sessionId = data.sessionID
      if (!msgId || !sessionId) return

      const entry: MessageEntry = {
        cost: data.cost ?? 0,
        inputTokens: data.tokens?.input ?? 0,
        outputTokens: data.tokens?.output ?? 0
      }

      let sessionMap = this.data.get(sessionId)
      if (!sessionMap) {
        sessionMap = new Map()
        this.data.set(sessionId, sessionMap)
        // Resolve project path asynchronously (best-effort)
        void this.resolveProjectPath(sessionId)
      }

      const prev = sessionMap.get(msgId)
      if (prev && prev.cost === entry.cost && prev.inputTokens === entry.inputTokens && prev.outputTokens === entry.outputTokens) {
        return
      }

      sessionMap.set(msgId, entry)
      this.emit('change')
    } catch {
      // File missing, malformed JSON — ignore silently
    }
  }

  private async resolveProjectPath(sessionId: string): Promise<void> {
    try {
      const sessionFile = join(opencodeStorageRoot(), 'session', `${sessionId}.json`)
      const sessionRaw = await fs.readFile(sessionFile, 'utf8')
      const session = JSON.parse(sessionRaw) as StorageSession
      const projectID = session.projectID
      if (!projectID) return

      const projectFile = join(opencodeStorageRoot(), 'project', `${projectID}.json`)
      const projectRaw = await fs.readFile(projectFile, 'utf8')
      const project = JSON.parse(projectRaw) as StorageProject
      if (typeof project.worktree === 'string' && project.worktree.length > 0) {
        this.projectPaths.set(sessionId, project.worktree)
        this.emit('change')
      }
    } catch {
      // Session or project file missing — fall back to sessionId as identifier
    }
  }
}

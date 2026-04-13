import { EventEmitter } from 'events'
import chokidar, { FSWatcher } from 'chokidar'
import fs from 'fs/promises'
import { join, basename, dirname } from 'path'
import { homedir } from 'os'
import type { ClaudeCodeSessionUsage } from './types'

interface FinalizedEntry {
  inputTokens: number
  outputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
  model: string
}

interface SessionAccumulator {
  projectPath: string
  messages: Map<string, FinalizedEntry>
}

export class ClaudeCodeAnalyticsCollector extends EventEmitter {
  private watcher: FSWatcher | null = null
  // Map<filePath, byteOffset>
  private offsets = new Map<string, number>()
  // Map<filePath, partialLine>
  private partials = new Map<string, string>()
  // Map<sessionId, SessionAccumulator>
  private sessions = new Map<string, SessionAccumulator>()

  start(): void {
    const claudeProjectsDir = join(homedir(), '.claude', 'projects')
    this.watcher = chokidar.watch(claudeProjectsDir, {
      depth: 3,
      ignoreInitial: false,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 }
    })

    this.watcher.on('add', (filePath: string) => {
      if (!filePath.endsWith('.jsonl')) return
      this.offsets.set(filePath, 0)
      this.partials.set(filePath, '')
      void this.readFile(filePath)
    })

    this.watcher.on('change', (filePath: string) => {
      if (!filePath.endsWith('.jsonl')) return
      void this.readFile(filePath)
    })
  }

  dispose(): void {
    void this.watcher?.close()
    this.watcher = null
    this.offsets.clear()
    this.partials.clear()
    this.sessions.clear()
  }

  getUsage(): ClaudeCodeSessionUsage[] {
    const results: ClaudeCodeSessionUsage[] = []
    for (const [sessionId, acc] of this.sessions) {
      let inputTokens = 0
      let outputTokens = 0
      let cacheWriteTokens = 0
      let cacheReadTokens = 0
      let model = 'unknown'
      for (const entry of acc.messages.values()) {
        inputTokens += entry.inputTokens
        outputTokens += entry.outputTokens
        cacheWriteTokens += entry.cacheWriteTokens
        cacheReadTokens += entry.cacheReadTokens
        if (entry.model !== 'unknown') model = entry.model
      }
      results.push({
        sessionId,
        projectPath: acc.projectPath,
        inputTokens,
        outputTokens,
        cacheWriteTokens,
        cacheReadTokens,
        model,
        messageCount: acc.messages.size
      })
    }
    return results
  }

  private async readFile(filePath: string): Promise<void> {
    const offset = this.offsets.get(filePath) ?? 0
    let partial = this.partials.get(filePath) ?? ''

    let fileHandle: import('fs/promises').FileHandle | null = null
    try {
      fileHandle = await fs.open(filePath, 'r')
      const stat = await fileHandle.stat()
      const size = stat.size
      if (size <= offset) return

      const bufSize = size - offset
      const buf = Buffer.allocUnsafe(bufSize)
      const { bytesRead } = await fileHandle.read(buf, 0, bufSize, offset)
      const chunk = buf.slice(0, bytesRead).toString('utf8')

      this.offsets.set(filePath, offset + bytesRead)

      const combined = partial + chunk
      const lines = combined.split('\n')
      // Last element may be incomplete — save as new partial
      const newPartial = lines.pop() ?? ''
      this.partials.set(filePath, newPartial)

      let changed = false
      // Process in batches of 16 with semaphore
      for (let i = 0; i < lines.length; i++) {
        if (i > 0 && i % 16 === 0) {
          await new Promise<void>((res) => setImmediate(res))
        }
        const line = lines[i].trim()
        if (!line) continue
        if (!line.includes('"type":"assistant"')) continue
        changed = this.parseLine(filePath, line) || changed
      }

      if (changed) this.emit('change')
    } catch (err) {
      console.warn('[ClaudeCodeAnalyticsCollector] read error:', filePath, err)
    } finally {
      await fileHandle?.close()
    }
  }

  private parseLine(filePath: string, line: string): boolean {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(line) as Record<string, unknown>
    } catch {
      console.warn('[ClaudeCodeAnalyticsCollector] JSON parse error in', filePath)
      return false
    }

    if (parsed['type'] !== 'assistant') return false

    const message = parsed['message'] as Record<string, unknown> | undefined
    if (!message) return false

    const stopReason = message['stop_reason']
    if (stopReason === null || stopReason === undefined) return false

    const msgId = (parsed['uuid'] as string | undefined) ?? (message['id'] as string | undefined)
    if (!msgId) return false

    const usage = message['usage'] as Record<string, unknown> | undefined
    if (!usage) return false

    const entry: FinalizedEntry = {
      inputTokens: (usage['input_tokens'] as number | undefined) ?? 0,
      outputTokens: (usage['output_tokens'] as number | undefined) ?? 0,
      cacheWriteTokens: (usage['cache_creation_input_tokens'] as number | undefined) ?? 0,
      cacheReadTokens: (usage['cache_read_input_tokens'] as number | undefined) ?? 0,
      model: (message['model'] as string | undefined) ?? 'unknown'
    }

    const { sessionId, projectPath } = this.deriveIds(filePath)
    if (!sessionId) return false

    let acc = this.sessions.get(sessionId)
    if (!acc) {
      acc = { projectPath, messages: new Map() }
      this.sessions.set(sessionId, acc)
    }

    const prev = acc.messages.get(msgId)
    if (
      prev &&
      prev.inputTokens === entry.inputTokens &&
      prev.outputTokens === entry.outputTokens &&
      prev.cacheWriteTokens === entry.cacheWriteTokens &&
      prev.cacheReadTokens === entry.cacheReadTokens
    ) {
      return false
    }

    acc.messages.set(msgId, entry)
    return true
  }

  /**
   * Derive sessionId and projectPath from a JSONL file path.
   *
   * Claude CLI encodes project paths as the directory name under
   * ~/.claude/projects/ by replacing '/' with '-'.
   *
   * Layout:
   *   ~/.claude/projects/<encodedPath>/<sessionId>/<anything>.jsonl
   *   ~/.claude/projects/<encodedPath>/<sessionId>/subagents/<anything>.jsonl
   */
  private deriveIds(filePath: string): { sessionId: string; projectPath: string } {
    // Normalise to forward slashes, split
    const parts = filePath.split('/')
    // Find the index of 'projects' in the path
    const projectsIdx = parts.lastIndexOf('projects')
    if (projectsIdx < 0) return { sessionId: '', projectPath: '' }

    const encodedProject = parts[projectsIdx + 1] ?? ''
    const sessionId = parts[projectsIdx + 2] ?? ''
    // encodedPath: replace '-' with '/'
    const projectPath = '/' + encodedProject.replace(/-/g, '/')

    return { sessionId, projectPath }
  }
}

/**
 * ClaudeParser — infers session state from a Claude Code JSONL conversation log.
 *
 * Strategy: tail-read the last 4KB of the file to avoid loading multi-MB
 * conversation logs into memory. Walk backwards through the parsed lines to
 * find the most recent state signal.
 *
 * State signals (in priority order):
 *   1. Last assistant message with stop_reason "tool_use" → running
 *   2. Last system message with subtype "stop_hook_summary" or "turn_duration" → idle
 *   3. Last user message is more recent than last assistant message → running
 *   4. No messages → idle (session just started)
 */
import { promises as fs } from 'fs'
import { basename } from 'path'
import type { ClaudeSessionState } from './types'

const TAIL_BYTES = 4096
/** Upper bound on how much we'll read to find a parseable last line. */
const MAX_TAIL_BYTES = 64 * 1024

/** Tool name → human-readable action label */
const TOOL_LABELS: Record<string, string> = {
  Bash: '⚙ running shell command',
  Read: '✎ reading file',
  Edit: '✎ editing file',
  Write: '✎ editing file',
  Glob: '⚙ searching codebase',
  Grep: '⚙ searching codebase',
  Agent: '⚙ spawning subagent',
  WebFetch: '⚙ fetching web',
  WebSearch: '⚙ fetching web'
}

function toolLabel(name: string): string {
  if (name in TOOL_LABELS) return TOOL_LABELS[name]
  if (name.startsWith('mcp__')) return '⚙ using MCP tool'
  return '⚙ working…'
}

export interface ParseResult {
  state: ClaudeSessionState
  currentAction: string
  lastActivity: number
  statusLine?: string
}

/**
 * Parse the tail of a JSONL file to infer session state.
 * Returns null if the file cannot be read.
 */
export async function parseSessionState(
  jsonlPath: string,
  fallbackTimestamp: number
): Promise<ParseResult | null> {
  let entries: Array<{ type: string; [k: string]: unknown }> = []
  try {
    const stat = await fs.stat(jsonlPath)
    const fileSize = stat.size
    if (fileSize === 0) {
      return { state: 'idle', currentAction: '◌ idle', lastActivity: fallbackTimestamp }
    }

    const fd = await fs.open(jsonlPath, 'r')
    try {
      // Grow the read window if the *last* line fails to parse — a single
      // very long message can straddle the 4KB boundary and starve us of the
      // most recent state signal otherwise. Cap at MAX_TAIL_BYTES so we don't
      // slurp unbounded history.
      let readSize = Math.min(TAIL_BYTES, fileSize)
      for (;;) {
        const offset = fileSize - readSize
        const buf = Buffer.alloc(readSize)
        await fd.read(buf, 0, readSize, offset)
        const raw = buf.toString('utf8')
        const lines = raw.split('\n').filter((l) => l.trim().length > 0)
        // Drop the first line if we didn't read from the start of the file —
        // it may be partial and was just truncated mid-JSON.
        if (offset > 0 && lines.length > 0) lines.shift()

        entries = []
        let lastLineOk = true
        for (let i = 0; i < lines.length; i++) {
          try {
            entries.push(JSON.parse(lines[i]))
          } catch {
            if (i === lines.length - 1) lastLineOk = false
          }
        }

        if (lastLineOk || readSize >= MAX_TAIL_BYTES || readSize >= fileSize) break
        readSize = Math.min(readSize * 4, MAX_TAIL_BYTES, fileSize)
      }
    } finally {
      await fd.close()
    }
  } catch {
    return null
  }

  if (entries.length === 0) {
    return { state: 'idle', currentAction: '◌ idle', lastActivity: fallbackTimestamp }
  }

  // Find the last timestamp from any entry.
  let lastActivity = fallbackTimestamp
  for (const e of entries) {
    const ts = e.timestamp
    if (typeof ts === 'string') {
      const ms = Date.parse(ts)
      if (!isNaN(ms) && ms > lastActivity) lastActivity = ms
    }
  }

  // Walk backwards to find state signals.
  let lastAssistantIdx = -1
  let lastUserIdx = -1
  let lastSystemStopIdx = -1

  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (e.type === 'assistant' && lastAssistantIdx === -1) lastAssistantIdx = i
    if (e.type === 'user' && lastUserIdx === -1) lastUserIdx = i
    if (
      e.type === 'system' &&
      typeof e.subtype === 'string' &&
      (e.subtype === 'stop_hook_summary' || e.subtype === 'turn_duration') &&
      lastSystemStopIdx === -1
    ) {
      lastSystemStopIdx = i
    }
    // Stop once we have all three signals.
    if (lastAssistantIdx !== -1 && lastUserIdx !== -1 && lastSystemStopIdx !== -1) break
  }

  // Determine state.
  let state: ClaudeSessionState = 'idle'
  let currentAction = '◌ idle'

  if (lastAssistantIdx !== -1) {
    const assistantEntry = entries[lastAssistantIdx]
    const msg = assistantEntry.message as { stop_reason?: string; content?: unknown[] } | undefined
    const stopReason = msg?.stop_reason

    if (stopReason === 'tool_use') {
      // Agent is mid-turn, actively using a tool.
      const content = msg?.content ?? []
      const toolUse = content.find(
        (c): c is { type: string; name: string; input?: unknown } =>
          typeof c === 'object' && c !== null && (c as { type?: string }).type === 'tool_use'
      )
      if (toolUse?.name === 'AskUserQuestion') {
        state = 'question'
        const questions = (toolUse.input as { questions?: Array<{ question?: string; header?: string }> }).questions
        const first = questions?.[0]
        const questionText = first?.header ?? first?.question ?? ''
        currentAction = questionText
          ? '? ' + questionText.slice(0, 80).replace(/\n/g, ' ')
          : '? waiting for input'
      } else {
        state = 'running'
        currentAction = toolUse ? toolLabel(toolUse.name) : '⚙ working…'
      }
    } else if (stopReason === 'end_turn') {
      // Turn completed. Check if a user message came after (agent about to start).
      if (lastUserIdx > lastAssistantIdx) {
        state = 'running'
        currentAction = '⚙ processing…'
      } else {
        state = 'idle'
        // Use last text content as the idle action description.
        const content = (msg?.content ?? []) as Array<{ type?: string; text?: string }>
        const textPart = content.find((c) => c.type === 'text')
        if (textPart?.text) {
          const truncated = textPart.text.slice(0, 60).replace(/\n/g, ' ')
          currentAction = `✓ ${truncated}`
        } else {
          currentAction = '✓ done'
        }
      }
    } else {
      // stop_reason is null or unknown — assistant turn in progress.
      state = 'running'
      currentAction = '⚙ working…'
    }
  } else if (lastUserIdx !== -1) {
    // User sent a message but agent hasn't responded yet.
    state = 'running'
    currentAction = '⚙ processing…'
  }

  // System stop signal overrides if it's more recent than the assistant signal.
  if (lastSystemStopIdx > lastAssistantIdx && lastSystemStopIdx > lastUserIdx) {
    state = 'idle'
    currentAction = '◌ idle'
  }

  // Extract statusLine: last assistant end_turn entry with text content.
  let statusLine: string | undefined
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (e.type !== 'assistant') continue
    const m = e.message as { stop_reason?: string; content?: unknown[] } | undefined
    if (m?.stop_reason !== 'end_turn') continue
    const content = (m.content ?? []) as Array<{ type?: string; text?: string }>
    // Walk content backwards to find last text block.
    for (let j = content.length - 1; j >= 0; j--) {
      const block = content[j]
      if (block.type === 'text' && block.text) {
        statusLine = block.text.slice(0, 120).replace(/\n/g, ' ')
        break
      }
    }
    if (statusLine !== undefined) break
  }

  return { state, currentAction, lastActivity, statusLine }
}

/**
 * Decode a Claude Code project path encoding back to an absolute path.
 * Claude Code encodes: leading '/' dropped, remaining '/' replaced with '-'.
 * Example: '-Users-julian-projects-auth-service' → '/Users/julian/projects/auth-service'
 *
 * Note: This is ambiguous for paths containing hyphens. We accept this
 * limitation — cross-reference with cwd from sessions JSON when possible.
 */
export function decodeProjectPath(encoded: string): string {
  return '/' + encoded.replace(/-/g, '/')
}

/**
 * Encode an absolute path to Claude Code's project directory naming convention.
 */
export function encodeProjectPath(absolutePath: string): string {
  return absolutePath.replace(/\//g, '-').replace(/^-/, '')
}

/**
 * Extract the display name from a project path (last non-empty segment).
 */
export function projectName(absolutePath: string): string {
  const parts = absolutePath.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? basename(absolutePath)
}

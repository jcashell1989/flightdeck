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
}

/**
 * Parse the tail of a JSONL file to infer session state.
 * Returns null if the file cannot be read.
 */
export async function parseSessionState(
  jsonlPath: string,
  fallbackTimestamp: number
): Promise<ParseResult | null> {
  let raw: string
  try {
    const stat = await fs.stat(jsonlPath)
    const fileSize = stat.size
    if (fileSize === 0) {
      return { state: 'idle', currentAction: '◌ idle', lastActivity: fallbackTimestamp }
    }

    const fd = await fs.open(jsonlPath, 'r')
    try {
      const readSize = Math.min(TAIL_BYTES, fileSize)
      const offset = fileSize - readSize
      const buf = Buffer.alloc(readSize)
      await fd.read(buf, 0, readSize, offset)
      raw = buf.toString('utf8')
    } finally {
      await fd.close()
    }
  } catch {
    return null
  }

  // Split into lines, drop the first (possibly partial) line if we didn't
  // read from the start of the file.
  const lines = raw.split('\n').filter((l) => l.trim().length > 0)
  if (lines.length > 1) lines.shift() // drop potentially partial first line

  // Parse lines, ignoring malformed JSON.
  const entries: Array<{ type: string; [k: string]: unknown }> = []
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line))
    } catch {
      // skip malformed
    }
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
      state = 'running'
      const content = msg?.content ?? []
      const toolUse = content.find(
        (c): c is { type: string; name: string } =>
          typeof c === 'object' && c !== null && (c as { type?: string }).type === 'tool_use'
      )
      currentAction = toolUse ? toolLabel(toolUse.name) : '⚙ working…'
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

  return { state, currentAction, lastActivity }
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

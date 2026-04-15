/**
 * Internal types for the Claude Code passive monitor.
 *
 * These are separate from the renderer's Session/Project types — the monitor
 * translates into NormalizedSession/NormalizedProject before merging with the
 * opencode snapshot.
 */

export type ClaudeSessionState = 'running' | 'idle' | 'error' | 'question' | 'approval'

export interface ClaudeSession {
  /** UUID from ~/.claude/sessions/<pid>.json */
  sessionId: string
  /** OS process ID */
  pid: number
  /** Absolute path to the project directory (from sessions JSON `cwd`) */
  cwd: string
  /** Unix ms from sessions JSON `startedAt` */
  startedAt: number
  /** Inferred state */
  state: ClaudeSessionState
  /** Human-readable current action */
  currentAction: string
  /** Unix ms of last JSONL entry (or startedAt if no entries yet) */
  lastActivity: number
  /** Last end_turn text content, truncated to 120 chars */
  statusLine?: string
  /** Pending tool-approval request from a control_request stdout event */
  pendingPermissionRequest?: {
    requestId: string
    toolName: string
    input: Record<string, unknown>
    toolUseId: string
  } | null
}

export interface ClaudeProject {
  /** Encoded project path (as used in ~/.claude/projects/) */
  encodedPath: string
  /** Decoded absolute path */
  path: string
  /** Display name (last path segment) */
  name: string
  sessions: ClaudeSession[]
}

/** Snapshot emitted by ClaudeMonitor */
export interface ClaudeSnapshot {
  projects: ClaudeProject[]
}

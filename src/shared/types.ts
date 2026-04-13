/**
 * Shared type definitions that cross the IPC boundary.
 *
 * Single source of truth for everything main, preload, and renderer agree on.
 * Renderer-only UI types (e.g. `View`) and renderer-only helpers (e.g.
 * `isAttention`) live in `src/renderer/src/types.ts` and import from here.
 *
 * Do NOT import Electron APIs or Node built-ins from this file — it must be
 * safe to include from the renderer context.
 */

// ── Config types ──────────────────────────────────────────────────────────

export interface OpencodeInstance {
  host: string
  port: number
  label?: string
}

export interface ProjectConfig {
  /** Absolute path to the project directory */
  path: string
  /** Optional display name override (defaults to last path segment) */
  name?: string
  /** Soft-deleted projects are hidden from the dashboard but preserved */
  archived: boolean
  /** Default agent type for sessions in this project */
  defaultAgent?: 'opencode' | 'claude-code' | 'auto'
}

export interface GitStatusResult {
  branch: string
  dirty: boolean
  ahead: number
  behind: number
}

export interface AgentProfile {
  /** Stable UUID — never changes after creation */
  id: string
  /** Human-readable name shown in Settings and the dispatch overlay */
  label: string
  /** Agent type. Only 'opencode' profiles are dispatchable. */
  agentType: 'opencode' | 'claude-code'
  /** Provider identifier passed as OPENCODE_PROVIDER env var (e.g. 'openrouter', 'anthropic') */
  provider?: string
  /** Model identifier passed as OPENCODE_MODEL env var (e.g. 'openrouter/kimi-k2.5') */
  model?: string
  /**
   * Decrypted API key — present in memory only, never written to disk.
   * On disk the key is stored as `apiKeyEncrypted` (base64 safeStorage ciphertext)
   * in the persisted config. See `src/main/config/store.ts` for the
   * serialisation layer that enforces this invariant.
   */
  apiKey?: string
  /** When true, this profile is pre-selected in the dispatch overlay */
  isDefault: boolean
}

export interface HttpConfig {
  enabled: boolean
  /** Network interface to bind to. '0.0.0.0' = all interfaces (required for Tailscale). */
  bindAddress: string
  port: number
  /** Bearer token for mobile client auth. Generated once at first run. Plaintext — local-network secret. */
  token: string
}

export interface AppConfig {
  opencode: { instances: OpencodeInstance[] }
  mock: { enabled: boolean }
  http: HttpConfig
  projects: ProjectConfig[]
  profiles: AgentProfile[]
}

// ── Session / snapshot types ──────────────────────────────────────────────

export type SessionState =
  | 'running'
  | 'idle'
  | 'approval'
  | 'question'
  | 'review'
  | 'error'

export interface PendingPermission {
  id: string
  type: string
  title?: string
  pattern?: string
  command?: string
  metadata: Record<string, unknown>
}

export interface Session {
  id: string
  agentType: 'opencode' | 'claude-code' | 'codex'
  state: SessionState
  currentAction: string
  startedAt: number
  lastActivity: number
  projectId: string
  instanceKey?: string
  pendingPermission?: PendingPermission | null
}

export interface Project {
  id: string
  name: string
  path: string
  sessions: Session[]
}

export type ConnectionStatus =
  | 'disabled'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error'

export interface PerInstanceStatus {
  key: string
  status: Exclude<ConnectionStatus, 'disabled'>
  lastError: string | null
}

export interface AggregateStatus {
  status: ConnectionStatus
  perInstance: PerInstanceStatus[]
}

export interface OpencodeSnapshotPayload {
  projects: Project[]
  aggregateStatus: AggregateStatus
}

// ── IPC auxiliary types ───────────────────────────────────────────────────

export interface ProcessResult {
  stdout: string
  stderr: string
  code: number
}

export interface MessageInfo {
  id: string
  role: 'user' | 'assistant'
  time?: { created: number }
  [k: string]: unknown
}

export interface MessagePart {
  id?: string
  type: string
  text?: string
  filename?: string
  tool?: string
  state?: { status?: string; output?: string; input?: unknown }
  [k: string]: unknown
}

export interface MessageRecord {
  info: MessageInfo
  parts: MessagePart[]
}

export interface ProjectValidationResult {
  valid: boolean
  reason?: string
  isGitRepo?: boolean
}

export interface CommandDefinition {
  name: string
  description: string
  source: string
  template?: string
}

// ── Codex types ───────────────────────────────────────────────────────────

export type CodexSessionState = 'running' | 'idle'

export interface CodexSession {
  id: string
  title: string
  cwd: string
  model: string
  state: CodexSessionState
  startedAt: number
  lastActivity: number
}

export interface CodexSnapshot {
  sessions: CodexSession[]
}

// ── Analytics types ───────────────────────────────────────────────────────

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

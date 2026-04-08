/**
 * Renderer types. IPC-crossing types live in `src/shared/types.ts` — re-exported
 * here so existing renderer imports like `from '../types'` keep working. New
 * code can import from either path; prefer `shared/types` for IPC-crossing
 * structures so the single-source-of-truth link is obvious.
 *
 * This file owns renderer-only additions: `View` (nav state) and the
 * `ATTENTION_STATES` / `isAttention` helper used by dashboards, sorts, and
 * badges.
 */
export type {
  AgentProfile,
  AggregateStatus,
  AppConfig,
  ConnectionStatus,
  MessageRecord,
  OpencodeInstance,
  OpencodeSnapshotPayload,
  PendingPermission,
  PerInstanceStatus,
  ProcessResult,
  Project,
  ProjectConfig,
  ProjectValidationResult,
  Session,
  SessionState
} from '../../shared/types'

import type { SessionState } from '../../shared/types'

export type View = 'dashboard' | 'sessions' | 'projects' | 'settings'

// Attention states: anything that wants the user's eyes.
// `idle` is here because an idle agent with no reason to be idle is a problem.
// `review` is reserved for Phase 3 (needs diff/watermark signal) and is currently never assigned.
export const ATTENTION_STATES: ReadonlySet<SessionState> = new Set<SessionState>([
  'approval',
  'question',
  'error',
  'idle'
])

export function isAttention(state: SessionState): boolean {
  return ATTENTION_STATES.has(state)
}

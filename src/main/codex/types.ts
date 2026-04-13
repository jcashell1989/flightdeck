/**
 * Re-export Codex types from shared so main-process code can import
 * from a local path while shared/types.ts remains the single source of truth.
 */
export type { CodexSession, CodexSessionState, CodexSnapshot } from '../../shared/types'
